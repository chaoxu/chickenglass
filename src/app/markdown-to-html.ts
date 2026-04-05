/**
 * Markdown-to-HTML converter for export.
 *
 * Converts Pandoc-flavored markdown to semantic HTML by walking a Lezer
 * syntax tree. This replaces the line-oriented parser with a proper AST
 * transform, giving correct handling of nested structures, inline
 * formatting inside blocks, and math rendering.
 *
 * Features:
 * - Headings, paragraphs, lists (ordered, unordered, task lists)
 * - Inline formatting: bold, italic, strikethrough, highlight, inline code
 * - Math rendering via KaTeX (inline and display)
 * - Fenced div blocks as semantic `<div>` elements
 * - Code blocks with language classes
 * - Horizontal rules, tables
 * - Footnotes
 */

import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import type { InlineRenderSurface } from "../inline-surface";
import {
  type InlineFragment,
  buildInlineFragments,
  parseInlineFragments,
} from "../inline-fragments";
import { htmlRenderExtensions } from "../parser";
import { readBracedLabelId } from "../parser/label-utils";
import { isSafeUrl } from "../lib/url-utils";
import { renderKatexToHtml, sanitizeCslHtml } from "../render/inline-shared";
import { resolveProjectPathFromDocument } from "../lib/project-paths";
import { isRelativeFilePath } from "../lib/pdf-target";
import { capitalize } from "../lib/utils";
import { type CslJsonItem } from "../citations/bibtex-parser";
import { formatBibEntry, sortBibEntries } from "../citations/bibliography";
import {
  type BibStore,
} from "../citations/citation-render";
import {
  CslProcessor,
  collectCitationBacklinkIndexFromReferences,
  collectCitationMatches,
  registerCitationsWithProcessor,
} from "../citations/csl-processor";
import {
  analyzeDocumentSemantics,
  stringTextSource,
  type DocumentSemantics,
} from "../semantics/document";
import { BLOCK_MANIFEST_ENTRIES, EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import { CSS } from "../constants/css-classes";

// ── Standalone Lezer parser ─────────────────────────────────────────────────

/**
 * Standalone Lezer markdown parser for HTML export / hover preview.
 *
 * Uses `htmlRenderExtensions` which includes Blockquote support
 * (the editor parser strips it via removeBlockquote since it uses
 * fenced divs instead, but the HTML renderer must handle `>` syntax).
 */
const mdParser = baseParser.configure(htmlRenderExtensions);

// ── Shared utilities ────────────────────────────────────────────────────────

/** Escape HTML special characters in text. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render KaTeX math, returning HTML string.
 * Falls back to escaped source on error.
 */
function renderMath(
  latex: string,
  displayMode: boolean,
  macros?: Record<string, string>,
): string {
  try {
    return renderKatexToHtml(latex, displayMode, macros ?? {});
  } catch (_e) {
    // best-effort: KaTeX render failed — show escaped source as error indicator
    const escaped = escapeHtml(latex);
    return displayMode
      ? `<pre class="math-error">${escaped}</pre>`
      : `<code class="math-error">${escaped}</code>`;
  }
}

// ── Options ─────────────────────────────────────────────────────────────────

// BlockCounterEntry lives in shared types so both the CM6-free HTML export
// path and the editor render layer can use it without crossing src/app/.
// Re-exported here for backward compatibility with existing callers.
import type { BlockCounterEntry } from "../lib/types";
export type { BlockCounterEntry };

/** Options for the markdown-to-HTML converter. */
export interface MarkdownToHtmlOptions {
  /** KaTeX macros from frontmatter for math rendering. */
  macros?: Record<string, string>;
  /** When true, add hierarchical section numbers to headings. */
  sectionNumbers?: boolean;
  /** Bibliography entries for citation resolution. */
  bibliography?: BibStore;
  /** CSL processor for citation/bibliography formatting. */
  cslProcessor?: CslProcessor;
  /**
   * Block counter entries keyed by block id (e.g. "thm-1" -> { type: "theorem", title: "Theorem", number: 1 }).
   *
   * Used for resolving cross-references like `[@thm-1]` to "Theorem 1" in
   * hover previews where CM6 state is available but the HTML renderer runs
   * standalone.
   */
  blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  /**
   * Current document path for resolving relative file-backed image targets.
   *
   * Used together with `imageUrlOverrides`, whose keys are resolved
   * project-relative paths.
   */
  documentPath?: string;
  /**
   * Prepared image source overrides keyed by resolved project-relative path.
   *
   * Read mode / HTML export use this to substitute browser-safe data URLs for
   * local file-backed image targets while keeping the core renderer
   * synchronous and CM6-free.
   */
  imageUrlOverrides?: ReadonlyMap<string, string>;
}

// ── Inline context ───────────────────────────────────────────────────────────

/**
 * Context object for inline rendering functions.
 *
 * `src/inline-fragments.ts` owns the shared tree walk. This context only
 * carries rendering policy and output concerns.
 */
interface InlineContext {
  readonly doc: string;
  macros?: Record<string, string>;
  bibliography?: BibStore;
  citedIds?: string[];
  nextCitationOccurrence?: { value: number };
  cslProcessor?: CslProcessor;
  blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  surface: HtmlInlineSurface;
  /** Document semantics for resolving crossref labels in HTML export. */
  semantics?: DocumentSemantics;
  documentPath?: string;
  imageUrlOverrides?: ReadonlyMap<string, string>;
}

type HtmlInlineSurface = InlineRenderSurface | "document-body";

function isUiChromeSurface(surface: HtmlInlineSurface): boolean {
  return surface === "ui-chrome-inline";
}

// ── Inline rendering (standalone, for titles) ───────────────────────────────

/**
 * Process inline markdown formatting within a line of text.
 *
 * This is a standalone function used by `read-mode-view.tsx` for rendering
 * frontmatter titles. It parses the text with Lezer and uses the tree walker.
 */
export function renderInline(
  text: string,
  macros?: Record<string, string>,
  surface: HtmlInlineSurface = "document-body",
): string {
  return renderInlineWithSurface(text, { doc: text, macros, surface });
}

function renderInlineWithSurface(
  text: string,
  options: Pick<
    InlineContext,
    "macros" | "bibliography" | "citedIds" | "nextCitationOccurrence" | "cslProcessor" | "blockCounters" | "surface" | "doc" | "semantics" | "documentPath" | "imageUrlOverrides"
  >,
): string {
  return renderInlineFragments(parseInlineFragments(text), {
    doc: options.doc,
    macros: options.macros,
    bibliography: options.bibliography,
    citedIds: options.citedIds,
    nextCitationOccurrence: options.nextCitationOccurrence,
    cslProcessor: options.cslProcessor,
    blockCounters: options.blockCounters,
    surface: options.surface,
    semantics: options.semantics,
    documentPath: options.documentPath,
    imageUrlOverrides: options.imageUrlOverrides,
  });
}

function renderDocumentInline(text: string, ctx: WalkContext): string {
  return renderInlineWithSurface(text, {
    doc: text,
    macros: ctx.macros,
    bibliography: ctx.bibliography,
    citedIds: ctx.citedIds,
    nextCitationOccurrence: ctx.nextCitationOccurrence,
    cslProcessor: ctx.cslProcessor,
    blockCounters: ctx.blockCounters,
    surface: "document-inline",
    semantics: ctx.semantics,
    documentPath: ctx.documentPath,
    imageUrlOverrides: ctx.imageUrlOverrides,
  });
}

// ── Tree walking ────────────────────────────────────────────────────────────

/** Context for the tree walker, carrying state across recursive calls. */
interface WalkContext {
  readonly doc: string;
  readonly macros?: Record<string, string>;
  readonly sectionNumbers: boolean;
  readonly semantics: DocumentSemantics;
  readonly bibliography?: BibStore;
  readonly cslProcessor?: CslProcessor;
  readonly blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  readonly surface: "document-body";
  /** Accumulates cited entry IDs in document order for the bibliography section. */
  readonly citedIds: string[];
  /** Precomputed bibliography backlinks keyed by citation id. */
  readonly citationBacklinks: ReadonlyMap<string, readonly { occurrence: number }[]>;
  /** Monotonic citation occurrence counter shared across inline rendering. */
  readonly nextCitationOccurrence: { value: number };
  readonly documentPath?: string;
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
}

/**
 * Convert markdown content to semantic HTML body content.
 *
 * Parses the content with Lezer and walks the syntax tree to produce HTML.
 */
export function markdownToHtml(
  content: string,
  options?: MarkdownToHtmlOptions,
): string {
  const tree = mdParser.parse(content);
  const semantics = analyzeDocumentSemantics(stringTextSource(content), tree);

  // Prefer a pre-built cslProcessor (already awaited via CslProcessor.create).
  // The inline fallback creates a processor whose async engine init has not
  // completed, so citations render in degraded plain-text mode.  Callers that
  // need full CSL formatting should pass `cslProcessor` explicitly.
  const cslProcessor = options?.cslProcessor ?? (options?.bibliography
    ? new CslProcessor([...options.bibliography.values()])
    : undefined);

  if (options?.bibliography && cslProcessor) {
    const matches = collectCitationMatches(semantics.references, options.bibliography);
    registerCitationsWithProcessor(matches, cslProcessor);
  }
  const citationBacklinkIndex = options?.bibliography
    ? collectCitationBacklinkIndexFromReferences(semantics.references, options.bibliography)
    : undefined;
  const ctx: WalkContext = {
    doc: content,
    macros: options?.macros,
    sectionNumbers: options?.sectionNumbers ?? false,
    semantics,
    bibliography: options?.bibliography,
    cslProcessor,
    blockCounters: options?.blockCounters,
    surface: "document-body",
    citedIds: [],
    citationBacklinks: citationBacklinkIndex?.backlinks ?? new Map(),
    nextCitationOccurrence: { value: 0 },
    documentPath: options?.documentPath,
    imageUrlOverrides: options?.imageUrlOverrides,
  };

  let html = renderNode(tree.topNode, ctx);

  // Render bibliography section if there are cited entries
  if (ctx.bibliography && ctx.citedIds.length > 0) {
    html += renderBibliography(ctx.bibliography, ctx.citedIds, ctx.cslProcessor, ctx.citationBacklinks);
  }

  return html;
}


/**
 * Render a syntax tree node to HTML.
 * Dispatches on node type and delegates to specialized renderers.
 */
function renderNode(node: SyntaxNode, ctx: WalkContext): string {
  switch (node.name) {
    case "Document":
      return renderDocument(node, ctx);

    case "Paragraph":
      return `<p>${renderChildren(node, ctx)}</p>`;

    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
      return renderHeading(node, ctx);

    case "FencedCode":
      return renderFencedCode(node, ctx);

    case "BulletList":
      return renderList(node, ctx, "ul");

    case "OrderedList":
      return renderList(node, ctx, "ol");

    case "HorizontalRule":
      return "<hr>";

    case "FencedDiv":
      return renderFencedDiv(node, ctx);

    case "DisplayMath":
      return renderDisplayMath(node, ctx);

    case "FootnoteDef":
      return renderFootnoteDef(node, ctx);

    case "Table":
      return renderTable(node, ctx);

    case "Blockquote":
      return renderBlockquote(node, ctx);

    default:
      // Unknown block — render children as fallback
      return renderDocChildren(node, ctx);
  }
}

/**
 * Render the Document node's children, skipping frontmatter.
 *
 * Frontmatter appears as a HorizontalRule at position 0 followed by
 * content then another HorizontalRule (since Lezer doesn't have a
 * frontmatter node). We detect the `---\n...\n---` pattern and skip it.
 */
function renderDocument(node: SyntaxNode, ctx: WalkContext): string {
  const output: string[] = [];
  let child = node.firstChild;

  // Detect and skip YAML frontmatter at start of document
  // Pattern: doc starts with --- and has a closing ---
  if (ctx.doc.startsWith("---")) {
    const firstNewline = ctx.doc.indexOf("\n");
    if (firstNewline !== -1) {
      const afterFirstLine = ctx.doc.slice(3, firstNewline).trim();
      if (afterFirstLine.length === 0) {
        const closingIndex = ctx.doc.indexOf("\n---", firstNewline);
        if (closingIndex !== -1) {
          const fmEnd = closingIndex + 4;
          // Skip nodes that fall within the frontmatter range
          while (child && child.to <= fmEnd) {
            child = child.nextSibling;
          }
          // Also skip the node that contains the closing --- if partially overlapping
          if (child && child.from < fmEnd) {
            child = child.nextSibling;
          }
        }
      }
    }
  }

  while (child) {
    const html = renderNode(child, ctx);
    if (html) output.push(html);
    child = child.nextSibling;
  }

  return output.join("\n");
}

/** Render child block nodes (for unknown wrapper nodes). */
function renderDocChildren(node: SyntaxNode, ctx: WalkContext): string {
  const output: string[] = [];
  let child = node.firstChild;
  while (child) {
    const html = renderNode(child, ctx);
    if (html) output.push(html);
    child = child.nextSibling;
  }
  return output.join("\n");
}

// ── Block renderers ─────────────────────────────────────────────────────────

/** Render an ATXHeading node. */
function renderHeading(node: SyntaxNode, ctx: WalkContext): string {
  const heading = ctx.semantics.headingByFrom.get(node.from);
  const levelChar = node.name[node.name.length - 1];
  const level = Number(levelChar);
  const renderedText = renderDocumentInline(
    heading?.text ?? ctx.doc.slice(node.from, node.to).trim(),
    ctx,
  );
  const prefix = ctx.sectionNumbers && heading?.number
    ? `<span class="${CSS.sectionNumber}">${heading.number}</span> `
    : "";

  return `<h${heading?.level ?? level}>${prefix}${renderedText}</h${heading?.level ?? level}>`;
}

/** Render a FencedCode node. */
function renderFencedCode(node: SyntaxNode, ctx: WalkContext): string {
  const codeInfo = node.getChild("CodeInfo");
  const lang = codeInfo ? ctx.doc.slice(codeInfo.from, codeInfo.to).trim() : "";

  // Extract code text between the code marks
  const codeText = node.getChild("CodeText");
  const code = codeText ? escapeHtml(ctx.doc.slice(codeText.from, codeText.to)) : "";

  const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<pre><code${langAttr}>${code}</code></pre>`;
}

/** Render a list (BulletList or OrderedList). */
function renderList(
  node: SyntaxNode,
  ctx: WalkContext,
  tag: "ul" | "ol",
): string {
  const items: string[] = [];
  let child = node.firstChild;

  while (child) {
    if (child.name === "ListItem") {
      items.push(renderListItem(child, ctx));
    }
    child = child.nextSibling;
  }

  const itemsHtml = items.map((item) => `<li>${item}</li>`).join("\n");
  return `<${tag}>\n${itemsHtml}\n</${tag}>`;
}

/** Render a ListItem node, handling task lists and nested content. */
function renderListItem(node: SyntaxNode, ctx: WalkContext): string {
  const parts: string[] = [];
  let child = node.firstChild;

  while (child) {
    if (child.name === "ListMark") {
      // Skip list markers (-, *, +, 1.)
    } else if (child.name === "Task") {
      // Task list item: contains TaskMarker + inline content
      const taskMarker = child.getChild("TaskMarker");
      if (taskMarker) {
        const markerText = ctx.doc.slice(taskMarker.from, taskMarker.to);
        const checked = markerText !== "[ ]" ? " checked" : "";
        parts.push(`<input type="checkbox" disabled${checked}>`);
      }
      // Render the task content (everything after TaskMarker)
      const contentStart = taskMarker ? taskMarker.to + 1 : child.from;
      const taskContent = ctx.doc.slice(contentStart, child.to);
      parts.push(renderInlineWithSurface(taskContent.trim(), {
        doc: taskContent.trim(),
        macros: ctx.macros,
        bibliography: ctx.bibliography,
        citedIds: ctx.citedIds,
        nextCitationOccurrence: ctx.nextCitationOccurrence,
        cslProcessor: ctx.cslProcessor,
        surface: "document-body",
      }));
    } else if (child.name === "Paragraph") {
      // Inline content — render without <p> wrapping
      parts.push(renderChildren(child, ctx));
    } else {
      // Block content (nested lists, math, code, divs, etc.)
      const html = renderNode(child, ctx);
      if (html) parts.push(html);
    }

    child = child.nextSibling;
  }

  return parts.join(" ");
}

/** Render a FencedDiv node. */
function renderFencedDiv(node: SyntaxNode, ctx: WalkContext): string {
  const semantics = ctx.semantics.fencedDivByFrom.get(node.from);
  const classes = semantics ? [...semantics.classes] : [];
  const id = semantics?.id;

  // Check for include directive — skip entirely
  if (classes.some((c) => EXCLUDED_FROM_FALLBACK.has(c))) {
    return "";
  }

  // Use cf-block class names (matching rich mode CM6 decorations) so both
  // modes share the same CSS rules. Emit "cf-block" once, then per-type classes.
  const cfClassList = classes.length > 0
    ? ["cf-block", ...classes.map((c) => `cf-block-${c}`)]
    : [];
  const classAttr = cfClassList.length > 0
    ? ` class="${cfClassList.map(escapeHtml).join(" ")}"`
    : "";
  const idAttr = id ? ` id="${escapeHtml(id)}"` : "";

  const title = semantics?.title ?? "";
  const isSelfClosing = semantics?.isSelfClosing ?? false;
  const primaryClass = BLOCK_MANIFEST_ENTRIES.find((entry) => classes.includes(entry.name));
  const captionBelow = primaryClass?.captionPosition === "below";
  const inlineHeader = primaryClass?.headerPosition === "inline";
  const headerLabel = escapeHtml(primaryClass?.title ?? capitalize(primaryClass?.name ?? ""));

  const output: string[] = [];
  output.push(`<div${classAttr}${idAttr}>`);

  if (title) {
    if (isSelfClosing) {
      output.push(`<p>${renderDocumentInline(title, ctx)}</p>`);
    } else if (!captionBelow && !inlineHeader) {
      output.push(`<strong class="${CSS.blockHeaderRendered}">${renderDocumentInline(title, ctx)}</strong>`);
    }
  }

  if (!isSelfClosing) {
    // Render inner content — skip FencedDivFence, FencedDivAttributes, FencedDivTitle
    const innerParts: string[] = [];
    let child = node.firstChild;
    while (child) {
      if (
        child.name !== "FencedDivFence" &&
        child.name !== "FencedDivAttributes" &&
        child.name !== "FencedDivTitle"
      ) {
        const html = renderNode(child, ctx);
        if (html) innerParts.push(html);
      }
      child = child.nextSibling;
    }
    if (innerParts.length > 0) {
      if (inlineHeader) {
        const inlineLabel = `<span class="${CSS.blockHeaderRendered}">${headerLabel}</span>`;
        const first = innerParts[0];
        if (first.startsWith("<p>")) {
          innerParts[0] = first.replace("<p>", `<p>${inlineLabel}`);
        } else {
          innerParts.unshift(`<p>${inlineLabel}</p>`);
        }
      }
      output.push(innerParts.join("\n"));
    }
  }

  if (!isSelfClosing && captionBelow && title) {
    const captionLabel = escapeHtml(primaryClass?.title ?? capitalize(primaryClass?.name ?? ""));
    output.push(
      `<div class="cf-block-caption"><span class="${CSS.blockHeaderRendered}">${captionLabel}</span><span class="cf-block-caption-text">${renderDocumentInline(title, ctx)}</span></div>`,
    );
  }

  output.push("</div>");
  return output.join("\n");
}

/** Render a DisplayMath node. */
function renderDisplayMath(node: SyntaxNode, ctx: WalkContext): string {
  const marks = node.getChildren("DisplayMathMark");
  let latex = "";

  if (marks.length >= 2) {
    const afterOpen = marks[0].to;
    const beforeClose = marks[marks.length - 1].from;
    if (beforeClose > afterOpen) {
      latex = ctx.doc.slice(afterOpen, beforeClose).trim();
    }
  } else if (marks.length === 1) {
    // Unclosed math — take everything after the opening mark
    latex = ctx.doc.slice(marks[0].to, node.to).trim();
  }

  const equationLabel = node.getChild("EquationLabel");
  const equationId = equationLabel
    ? readBracedLabelId(ctx.doc, equationLabel.from, equationLabel.to, "eq:")
    : null;
  const equationNumber = equationId
    ? ctx.semantics.equationById.get(equationId)?.number
    : undefined;
  const mathHtml = renderMath(latex, true, ctx.macros);
  if (equationNumber === undefined) {
    return `<div class="${CSS.mathDisplay}">${mathHtml}</div>`;
  }

  return `<div class="${CSS.mathDisplay} ${CSS.mathDisplayNumbered}"><div class="${CSS.mathDisplayContent}">${mathHtml}</div><span class="${CSS.mathDisplayNumber}">(${equationNumber})</span></div>`;
}

/** Render a FootnoteDef node. */
function renderFootnoteDef(node: SyntaxNode, ctx: WalkContext): string {
  const def = ctx.semantics.footnotes.defByFrom.get(node.from);
  if (!def) return "";

  const fnContent = def.content
    ? `<p>${renderInlineWithSurface(def.content, {
        doc: def.content,
        macros: ctx.macros,
        bibliography: ctx.bibliography,
        citedIds: ctx.citedIds,
        nextCitationOccurrence: ctx.nextCitationOccurrence,
        cslProcessor: ctx.cslProcessor,
        surface: "document-body",
      })}</p>`
    : "";

  return `<div class="footnote" id="fn-${escapeHtml(def.id)}"><sup>${escapeHtml(def.id)}</sup> ${fnContent}</div>`;
}

/** Render a Table node. */
function renderTable(node: SyntaxNode, ctx: WalkContext): string {
  const delimiterNode = node.getChild("TableDelimiter");
  if (!delimiterNode) return "";

  // Parse alignment from the delimiter row
  const delimText = ctx.doc.slice(delimiterNode.from, delimiterNode.to);
  const alignments = parseTableAlignments(delimText);

  /** Render a row of cells with a given tag (th or td). */
  const renderRow = (cells: readonly SyntaxNode[], tag: "th" | "td"): string => {
    let row = "";
    for (let c = 0; c < cells.length; c++) {
      const align = alignments[c] ? ` style="text-align: ${alignments[c]}"` : "";
      const content = renderChildren(cells[c], ctx);
      row += `<${tag}${align}>${content}</${tag}>\n`;
    }
    return row;
  };

  // Render header
  const headerNode = node.getChild("TableHeader");
  let html = "<table>\n<thead>\n<tr>\n";
  if (headerNode) {
    html += renderRow(headerNode.getChildren("TableCell"), "th");
  }
  html += "</tr>\n</thead>\n<tbody>\n";

  // Render body rows
  let child = node.firstChild;
  while (child) {
    if (child.name === "TableRow") {
      html += "<tr>\n";
      html += renderRow(child.getChildren("TableCell"), "td");
      html += "</tr>\n";
    }
    child = child.nextSibling;
  }

  html += "</tbody>\n</table>";
  return html;
}

/** Parse table alignments from a delimiter row like "| :--- | :---: | ---: |". */
function parseTableAlignments(delimRow: string): string[] {
  const cells = delimRow
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  return cells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

/** Render a Blockquote node as `<blockquote>` HTML. */
function renderBlockquote(node: SyntaxNode, ctx: WalkContext): string {
  const innerHtml = renderDocChildren(node, ctx);
  return `<blockquote>${innerHtml}</blockquote>`;
}

// ── Inline content rendering ────────────────────────────────────────────────

function renderChildren(
  node: SyntaxNode,
  ctx: InlineContext,
  rangeFrom?: number,
  rangeTo?: number,
): string {
  return renderInlineFragments(buildInlineFragments(node, ctx.doc, rangeFrom, rangeTo), ctx);
}

function renderInlineFragments(
  fragments: readonly InlineFragment[],
  ctx: InlineContext,
): string {
  return fragments.map((fragment) => renderInlineFragment(fragment, ctx)).join("");
}

function resolveOverriddenImageSrc(
  src: string,
  ctx: Pick<InlineContext, "documentPath" | "imageUrlOverrides">,
): string {
  if (!ctx.imageUrlOverrides || ctx.imageUrlOverrides.size === 0) return src;
  if (!isRelativeFilePath(src)) return src;

  const resolvedPath = resolveProjectPathFromDocument(ctx.documentPath ?? "", src);
  return ctx.imageUrlOverrides.get(resolvedPath) ?? src;
}

type InlineFragmentRenderer = (fragment: InlineFragment, ctx: InlineContext) => string;

/**
 * Dispatch map for inline fragment rendering.
 * Each entry handles one fragment kind; index type is narrowed by the caller.
 */
const inlineFragmentRenderers: {
  [K in InlineFragment["kind"]]: (
    fragment: Extract<InlineFragment, { kind: K }>,
    ctx: InlineContext,
  ) => string;
} = {
  text: (fragment) => escapeHtml(fragment.text),

  emphasis: (fragment, ctx) =>
    `<em class="${CSS.italic}">${renderInlineFragments(fragment.children, ctx)}</em>`,

  strong: (fragment, ctx) =>
    `<strong class="${CSS.bold}">${renderInlineFragments(fragment.children, ctx)}</strong>`,

  strikethrough: (fragment, ctx) =>
    `<del class="${CSS.strikethrough}">${renderInlineFragments(fragment.children, ctx)}</del>`,

  highlight: (fragment, ctx) =>
    `<mark class="${CSS.highlight}">${renderInlineFragments(fragment.children, ctx)}</mark>`,

  code: (fragment) => `<code class="${CSS.inlineCode}">${escapeHtml(fragment.text)}</code>`,

  math: (fragment, ctx) => renderMath(fragment.latex, false, ctx.macros),

  link: (fragment, ctx) => {
    const label = renderInlineFragments(fragment.children, ctx);
    if (isUiChromeSurface(ctx.surface)) return label;
    const href = fragment.href?.trim();
    if (!href) return label;
    if (isSafeUrl(href)) {
      return `<a href="${escapeHtml(href)}">${label}</a>`;
    }
    return `<span class="unsafe-link">${label}</span>`;
  },

  reference: (fragment, ctx) => {
    if (isUiChromeSurface(ctx.surface)) {
      return escapeHtml(fragment.rawText);
    }
    const citCtx: CitationRenderContext = {
      bibliography: ctx.bibliography,
      citedIds: ctx.citedIds,
      cslProcessor: ctx.cslProcessor,
      blockCounters: ctx.blockCounters,
      semantics: ctx.semantics,
      nextCitationOccurrence: ctx.nextCitationOccurrence,
    };
    return fragment.parenthetical
      ? renderCitationCluster(fragment.ids, fragment.locators, citCtx)
      : renderNarrativeReference(fragment.ids[0], citCtx);
  },

  image: (fragment, ctx) => {
    const alt = renderInlineFragments(fragment.alt, ctx);
    if (ctx.surface !== "document-body") return alt;
    const src = fragment.src?.trim();
    if (!src) return alt;
    if (isSafeUrl(src)) {
      const renderedSrc = resolveOverriddenImageSrc(src, ctx);
      return `<img src="${escapeHtml(renderedSrc)}" alt="${escapeHtml(fragment.rawAlt)}">`;
    }
    return `<span class="unsafe-link">${alt}</span>`;
  },

  "footnote-ref": (fragment, ctx) => {
    const fnId = escapeHtml(fragment.id);
    if (isUiChromeSurface(ctx.surface)) {
      return `<sup>${fnId}</sup>`;
    }
    return `<sup><a class="footnote-ref" href="#fn-${fnId}">${fnId}</a></sup>`;
  },

  "hard-break": (_fragment, ctx) =>
    ctx.surface === "document-body" ? "<br>" : " ",
};

function renderInlineFragment(
  fragment: InlineFragment,
  ctx: InlineContext,
): string {
  const renderer = inlineFragmentRenderers[fragment.kind] as InlineFragmentRenderer;
  return renderer(fragment, ctx);
}

// ── Citation render context ──────────────────────────────────────────────────

/**
 * Bundled context for citation and cross-reference rendering.
 * Replaces the four repeated parameters across renderCitationCluster /
 * renderNarrativeReference call sites.
 */
interface CitationRenderContext {
  bibliography?: BibStore;
  citedIds?: string[];
  cslProcessor?: CslProcessor;
  blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  semantics?: DocumentSemantics;
  nextCitationOccurrence?: { value: number };
}

// ── Citation / bibliography rendering ───────────────────────────────────────

/**
 * Resolve a crossref label from block counters and document semantics.
 *
 * Resolution order:
 * 1. Block counters (e.g. "Theorem 1") — from CM6 state passed as plain data
 * 2. Equation labels (e.g. "Eq. (3)") — from document semantics
 * 3. Heading labels — from document semantics
 * 4. Raw id fallback
 */
function resolveCrossrefLabel(
  id: string,
  semantics?: DocumentSemantics,
  blockCounters?: ReadonlyMap<string, BlockCounterEntry>,
): string {
  // 1. Block counter lookup (e.g. "thm-1" -> "Theorem 1")
  if (blockCounters) {
    const block = blockCounters.get(id);
    if (block) return `${block.title} ${block.number}`;
  }
  if (!semantics) return id;
  // 2. Equation label lookup
  const eq = semantics.equationById.get(id);
  if (eq) return `Eq. (${eq.number})`;
  // 3. Heading lookup by id attribute
  for (const heading of semantics.headings) {
    if (heading.id === id) {
      return heading.number ? `Section ${heading.number}` : heading.text;
    }
  }
  return id;
}

/**
 * Add cited ids to the bibliography accumulator, preserving first-use order.
 */
function trackCitedIds(
  ids: readonly string[],
  bibliography?: BibStore,
  citedIds?: string[],
): void {
  if (!bibliography || !citedIds) return;
  for (const id of ids) {
    if (bibliography.has(id) && !citedIds.includes(id)) {
      citedIds.push(id);
    }
  }
}

function nextCitationAnchorId(
  ids: readonly string[],
  bibliography: BibStore | undefined,
  nextCitationOccurrence: { value: number } | undefined,
): string | undefined {
  if (!bibliography || !nextCitationOccurrence) return undefined;
  const hasKnownId = ids.some((id) => bibliography.has(id));
  if (!hasKnownId) return undefined;
  nextCitationOccurrence.value += 1;
  return `cite-ref-${nextCitationOccurrence.value}`;
}

/**
 * Render a parenthetical citation cluster using the same formatting path
 * as rich mode when bibliography data is available.
 */
function renderCitationCluster(
  ids: readonly string[],
  locators: readonly (string | undefined)[] | undefined,
  citCtx: CitationRenderContext,
): string {
  const {
    bibliography,
    citedIds,
    cslProcessor,
    blockCounters,
    semantics,
    nextCitationOccurrence,
  } = citCtx;
  const knownCount = bibliography
    ? ids.filter((id) => bibliography.has(id)).length
    : 0;

  if (knownCount === 0) {
    const parts = ids.map((id) => {
      const label = resolveCrossrefLabel(id, semantics, blockCounters);
      return `<a class="cross-ref" href="#${escapeHtml(id)}">${escapeHtml(label)}</a>`;
    });
    if (ids.length === 1) {
      return parts[0];
    }
    return parts.join("; ");
  }

  trackCitedIds(ids, bibliography, citedIds);
  const anchorId = nextCitationAnchorId(ids, bibliography, nextCitationOccurrence);
  const anchorAttr = anchorId ? ` id="${anchorId}"` : "";

  if (bibliography && knownCount === ids.length && cslProcessor) {
    const normalizedLocators =
      locators && locators.some((locator) => locator != null) ? locators : undefined;
    const rendered = normalizedLocators
      ? cslProcessor.cite([...ids], [...normalizedLocators])
      : cslProcessor.cite([...ids]);
    return `<span${anchorAttr} class="${CSS.citation}">${escapeHtml(rendered)}</span>`;
  }

  // Mixed cluster: some ids are citations, some are cross-refs.
  // Cite the known ones individually via the processor.
  const parts = ids.map((id, index) => {
    if (bibliography?.has(id) && cslProcessor) {
      const rendered = cslProcessor.cite(
        [id],
        locators ? [locators[index]] : undefined,
      );
      // Strip outer parentheses from single-item cite results (e.g. "(Karger, 2000)" -> "Karger, 2000")
      const stripped = rendered.startsWith("(") && rendered.endsWith(")")
        ? rendered.slice(1, -1)
        : rendered;
      return escapeHtml(stripped);
    }
    const label = resolveCrossrefLabel(id, semantics, blockCounters);
    return `<a class="cross-ref" href="#${escapeHtml(id)}">${escapeHtml(label)}</a>`;
  });
  return `<span${anchorAttr} class="${CSS.citation}">(${parts.join("; ")})</span>`;
}

function renderNarrativeReference(id: string, citCtx: CitationRenderContext): string {
  const { bibliography, citedIds, cslProcessor, nextCitationOccurrence } = citCtx;
  if (bibliography?.has(id)) {
    trackCitedIds([id], bibliography, citedIds);
    const anchorId = nextCitationAnchorId([id], bibliography, nextCitationOccurrence);
    const anchorAttr = anchorId ? ` id="${anchorId}"` : "";
    if (cslProcessor) {
      return `<span${anchorAttr} class="${CSS.citation} ${CSS.citation}-narrative">${escapeHtml(cslProcessor.citeNarrative(id))}</span>`;
    }
    return `<span${anchorAttr} class="${CSS.citation} ${CSS.citation}-narrative">${escapeHtml(id)}</span>`;
  }

  return `<a class="cross-ref" href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`;
}

/** Render the bibliography section from cited entries. */
function renderBibliography(
  bib: BibStore,
  citedIds: string[],
  cslProcessor?: CslProcessor,
  citationBacklinks?: ReadonlyMap<string, readonly { occurrence: number }[]>,
): string {
  let cslHtml: string[] = [];
  if (cslProcessor) {
    cslHtml = cslProcessor.bibliography(citedIds);
  }

  const unsortedEntries = citedIds
    .map((id) => bib.get(id))
    .filter((e): e is CslJsonItem => e !== undefined);
  const entries = cslHtml.length > 0 ? unsortedEntries : sortBibEntries(unsortedEntries);

  if (entries.length === 0) return "";

  const items = cslHtml.length > 0
    ? entries.map((entry, i) =>
        `<div class="${CSS.bibliographyEntry}" id="bib-${escapeHtml(entry.id)}">${sanitizeCslHtml(cslHtml[i] ?? "")}${renderBibliographyBacklinks(entry.id, citationBacklinks)}</div>`)
    : entries.map((entry) =>
        `<div class="${CSS.bibliographyEntry}" id="bib-${escapeHtml(entry.id)}">${escapeHtml(formatBibEntry(entry))}${renderBibliographyBacklinks(entry.id, citationBacklinks)}</div>`);

  return [
    "",
    `<section class="${CSS.bibliography}">`,
    `<h2 class="${CSS.bibliographyHeading}">References</h2>`,
    `<div class="${CSS.bibliographyList}">`,
    items.join("\n"),
    "</div>",
    "</section>",
  ].join("\n");
}

function renderBibliographyBacklinks(
  id: string,
  citationBacklinks?: ReadonlyMap<string, readonly { occurrence: number }[]>,
): string {
  const backlinks = citationBacklinks?.get(id);
  if (!backlinks || backlinks.length === 0) return "";

  const links = backlinks.map((backlink) =>
    `<a class="${CSS.bibliographyBacklink}" href="#cite-ref-${backlink.occurrence}">↩${backlink.occurrence}</a>`).join(" ");
  return ` <span class="${CSS.bibliographyBacklinks}">cited at ${links}</span>`;
}
