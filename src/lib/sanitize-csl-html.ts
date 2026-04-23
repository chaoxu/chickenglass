import createDOMPurify from "dompurify";
import { isSafeUrl } from "./url-utils";

/**
 * Allowlist of HTML element names safe for CSL-formatted bibliography output.
 *
 * CSL styles produce formatting markup like `<i>`, `<b>`, `<sup>`, `<span>`.
 * Any element not in this list is stripped (its children are kept), unless it
 * is in DANGEROUS_CSL_ELEMENTS, in which case the element and its content are
 * removed entirely.
 */
const SAFE_CSL_ELEMENTS: readonly string[] = [
  "a", "abbr", "b", "br", "cite", "code", "div", "em", "i", "mark",
  "p", "q", "s", "small", "span", "strong", "sub", "sup", "u",
];

/**
 * Element names whose content must be dropped entirely, not lifted.
 *
 * `<script>` and `<style>` content is raw text in the HTML parser. If the
 * element is removed while lifting its children, the raw text leaks into the
 * parent. Remove both the element and its children.
 */
const DANGEROUS_CSL_ELEMENTS: readonly string[] = [
  "script", "style", "noscript", "template", "iframe", "object",
  "embed", "form", "input", "textarea", "button", "select",
];

/**
 * Allowlist of HTML attribute names that are safe on CSL-output elements.
 *
 * `href` is included for `<a>` tags but its value is validated through
 * `isSafeUrl` in a DOMPurify `afterSanitizeAttributes` hook.
 */
const SAFE_CSL_ATTRIBUTES: readonly string[] = [
  "class", "id", "href", "title",
];

let cslPurify: ReturnType<typeof createDOMPurify> | null = null;

function getCslPurify(): ReturnType<typeof createDOMPurify> {
  if (cslPurify) {
    return cslPurify;
  }
  if (typeof window === "undefined") {
    throw new Error("sanitizeCslHtml requires a browser-like window");
  }

  const purify = createDOMPurify(window);
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.hasAttribute("href")) {
      const href = node.getAttribute("href") ?? "";
      if (!isSafeUrl(href)) {
        node.removeAttribute("href");
      }
    }
  });
  cslPurify = purify;
  return purify;
}

/**
 * Sanitize HTML output from the CSL/citeproc engine for safe insertion via
 * `innerHTML`.
 *
 * The CSL engine may embed user-supplied bibliographic strings directly inside
 * its output. This function delegates to DOMPurify with a CSL-specific
 * allowlist.
 */
export function sanitizeCslHtml(raw: string): string {
  return getCslPurify().sanitize(raw, {
    ALLOWED_TAGS: [...SAFE_CSL_ELEMENTS],
    ALLOWED_ATTR: [...SAFE_CSL_ATTRIBUTES],
    FORBID_CONTENTS: [...DANGEROUS_CSL_ELEMENTS],
  });
}
