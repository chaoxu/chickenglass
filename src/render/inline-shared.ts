/**
 * Shared inline rendering utilities used by both the DOM renderer
 * (`inline-render.ts`) and the HTML string renderer (`markdown-to-html.ts`).
 *
 * Most functions are pure (no CM6 or DOM dependency). `sanitizeCslHtml` is the
 * exception — it requires a browser DOM for safe HTML parsing via `<template>`.
 */

import type { KatexOptions } from "katex";

// ── Mark nodes ──────────────────────────────────────────────────────────────

/**
 * Lezer node names that are syntactic "marks" (delimiters) and should be
 * skipped when rendering inline content.
 */
export const MARK_NODES: ReadonlySet<string> = new Set([
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "StrikethroughMark",
  "HighlightMark",
  "InlineMathMark",
  "HeaderMark",
  "ListMark",
  "TaskMarker",
  "TableDelimiter",
]);

// ── URL safety ──────────────────────────────────────────────────────────────

/**
 * Check whether a URL is safe to embed in `href` or `src` attributes.
 *
 * Blocks `javascript:`, `data:`, and `vbscript:` schemes.
 */
export function isSafeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return !(
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  );
}

/**
 * Allowlist of HTML element names safe for CSL-formatted bibliography output.
 *
 * CSL styles produce formatting markup like `<i>`, `<b>`, `<sup>`, `<span>`.
 * Any element not in this set is stripped (its children are kept), unless it
 * is in DANGEROUS_CSL_ELEMENTS, in which case the element AND its content
 * are removed entirely.
 */
const SAFE_CSL_ELEMENTS: ReadonlySet<string> = new Set([
  "a", "abbr", "b", "br", "cite", "code", "div", "em", "i", "mark",
  "p", "q", "s", "small", "span", "strong", "sub", "sup", "u",
]);

/**
 * Element names whose content must be dropped entirely, not lifted.
 *
 * `<script>` and `<style>` content is raw text in the HTML parser — if the
 * element is removed while lifting its children, the raw text leaks into the
 * parent. Remove both the element and its children.
 */
const DANGEROUS_CSL_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "style", "noscript", "template", "iframe", "object",
  "embed", "form", "input", "textarea", "button", "select",
]);

/**
 * Allowlist of HTML attribute names that are safe on CSL-output elements.
 *
 * `href` is included for `<a>` tags but its value is validated via `isSafeUrl`
 * at the point of element creation — see `sanitizeCslHtml`.
 */
const SAFE_CSL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "class", "id", "href", "title",
]);

/**
 * Sanitize HTML output from the CSL/citeproc engine for safe insertion via
 * `innerHTML`.
 *
 * The CSL engine may embed user-supplied bibliographic strings (titles, names,
 * URLs) directly inside its output. This function:
 *   - Parses the fragment with the browser's own HTML parser via a detached
 *     `<template>` element (no script execution, no network requests).
 *   - Walks the DOM and removes any element not in `SAFE_CSL_ELEMENTS`,
 *     lifting its children in place.
 *   - Removes any attribute not in `SAFE_CSL_ATTRIBUTES`.
 *   - Validates `href` values through `isSafeUrl` and removes unsafe ones.
 *
 * Returns a serialised HTML string.
 */
export function sanitizeCslHtml(raw: string): string {
  const template = document.createElement("template");
  template.innerHTML = raw;
  sanitizeFragment(template.content);
  // Serialize by collecting innerHTML from a wrapper span so we get the full
  // fragment rather than only a single root element.
  const wrapper = document.createElement("span");
  wrapper.appendChild(template.content.cloneNode(true));
  return wrapper.innerHTML;
}

function sanitizeFragment(root: DocumentFragment | Element): void {
  // Collect children first — we may mutate during iteration.
  const children = Array.from(root.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      // Text nodes are safe as-is.
      continue;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (DANGEROUS_CSL_ELEMENTS.has(tag)) {
        // Dangerous element: drop the element AND its entire content.
        el.remove();
      } else if (!SAFE_CSL_ELEMENTS.has(tag)) {
        // Unsupported element: recursively sanitize children, then lift them.
        sanitizeFragment(el);
        while (el.firstChild) {
          root.insertBefore(el.firstChild, el);
        }
        el.remove();
      } else {
        // Safe element: sanitize children and attributes.
        sanitizeFragment(el);
        sanitizeElementAttributes(el);
      }
    } else {
      // Comment, PI, etc. — remove entirely.
      child.parentNode?.removeChild(child);
    }
  }
}

function sanitizeElementAttributes(el: Element): void {
  // Snapshot the attribute names to avoid mutation-during-iteration issues.
  const attrNames = Array.from(el.attributes).map((a) => a.name);
  for (const name of attrNames) {
    if (!SAFE_CSL_ATTRIBUTES.has(name)) {
      el.removeAttribute(name);
      continue;
    }
    if (name === "href") {
      const value = el.getAttribute("href") ?? "";
      if (!isSafeUrl(value)) {
        el.removeAttribute("href");
      }
    }
  }
}

// ── KaTeX option builder ────────────────────────────────────────────────────

/**
 * Build canonical KaTeX options for `katex.renderToString`.
 *
 * - `throwOnError: false` — render error boxes instead of throwing
 * - `trust` — allows `\href` / `\url` with `https?://` targets
 * - Macros are spread to avoid KaTeX mutation of the caller's object
 */
export function buildKatexOptions(
  displayMode: boolean,
  macros?: Record<string, string>,
): KatexOptions {
  return {
    displayMode,
    throwOnError: false,
    trust: (context: { command: string; url?: string }) =>
      (context.command === "\\href" || context.command === "\\url") &&
      context.url != null &&
      /^https?:\/\//.test(context.url),
    ...(macros ? { macros: { ...macros } } : {}),
  };
}
