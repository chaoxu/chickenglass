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

import katex from "katex";
import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { markdownExtensions, extractDivClass } from "../parser";

// ── Standalone Lezer parser ─────────────────────────────────────────────────

/**
 * Standalone Lezer markdown parser using the shared extension list
 * from src/parser — same extensions the CM6 editor uses.
 */
const mdParser = baseParser.configure(markdownExtensions);

// ── Shared utilities ────────────────────────────────────────────────────────

/** Escape HTML special characters in text. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Check if a URL is safe to embed in href/src (blocks javascript:, data:, vbscript:). */
function isSafeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return false;
  }
  return true;
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
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      trust: (context: { command: string; url?: string }) =>
        (context.command === "\\href" || context.command === "\\url") &&
        context.url != null &&
        /^https?:\/\//.test(context.url),
      ...(macros ? { macros: { ...macros } } : {}),
    });
  } catch {
    const escaped = escapeHtml(latex);
    return displayMode
      ? `<pre class="math-error">${escaped}</pre>`
      : `<code class="math-error">${escaped}</code>`;
  }
}

// ── Options ─────────────────────────────────────────────────────────────────

/** Options for the markdown-to-HTML converter. */
export interface MarkdownToHtmlOptions {
  /** KaTeX macros from frontmatter for math rendering. */
  macros?: Record<string, string>;
  /** When true, add hierarchical section numbers to headings. */
  sectionNumbers?: boolean;
  /** Shared heading counters for recursive calls (internal use). */
  _counters?: number[];
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
): string {
  // Parse just the text as a paragraph (Lezer wraps it in Document > Paragraph)
  const tree = mdParser.parse(text);
  const doc = tree.topNode;
  // The text becomes a single Paragraph inside Document
  const para = doc.firstChild;
  if (!para) return escapeHtml(text);
  // Render the paragraph's inline content (without wrapping in <p>)
  return renderChildren(para, text, macros);
}

// ── Tree walking ────────────────────────────────────────────────────────────

/** Context for the tree walker, carrying state across recursive calls. */
interface WalkContext {
  readonly doc: string;
  readonly macros?: Record<string, string>;
  readonly sectionNumbers: boolean;
  readonly headingCounters: number[];
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
  const ctx: WalkContext = {
    doc: content,
    macros: options?.macros,
    sectionNumbers: options?.sectionNumbers ?? false,
    headingCounters: options?._counters ?? [0, 0, 0, 0, 0, 0, 0],
  };

  return renderNode(tree.topNode, ctx);
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
      return `<p>${renderChildren(node, ctx.doc, ctx.macros)}</p>`;

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
  const levelChar = node.name[node.name.length - 1];
  const level = Number(levelChar);

  // Get text after the HeaderMark (# symbols)
  const headerMark = node.getChild("HeaderMark");
  const textStart = headerMark ? headerMark.to : node.from;
  let rawText = ctx.doc.slice(textStart, node.to).trim();

  // Check for attribute block {.class #id -} at end
  const attrMatch = rawText.match(/\s*\{([^}]*)\}\s*$/);
  const isUnnumbered = attrMatch
    ? /(?:^|\s)(?:-|\.unnumbered)(?:\s|$)/.test(attrMatch[1])
    : false;

  // Strip the attribute block from text
  if (attrMatch) {
    rawText = rawText.slice(0, attrMatch.index).trim();
  }

  // Render inline content within the heading text
  const text = renderInline(rawText, ctx.macros);

  let prefix = "";
  if (ctx.sectionNumbers && !isUnnumbered) {
    ctx.headingCounters[level]++;
    for (let lv = level + 1; lv <= 6; lv++) ctx.headingCounters[lv] = 0;
    const parts: number[] = [];
    for (let lv = 1; lv <= level; lv++) parts.push(ctx.headingCounters[lv]);
    prefix = `<span class="cg-section-number">${parts.join(".")}</span> `;
  }

  return `<h${level}>${prefix}${text}</h${level}>`;
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
      parts.push(renderInline(taskContent.trim(), ctx.macros));
    } else if (child.name === "Paragraph") {
      // Inline content — render without <p> wrapping
      parts.push(renderChildren(child, ctx.doc, ctx.macros));
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
  // Parse attributes
  const attrNode = node.getChild("FencedDivAttributes");
  let classes: string[] = [];
  let id: string | undefined;

  if (attrNode) {
    const attrText = ctx.doc.slice(attrNode.from, attrNode.to);
    const parsed = extractDivClass(attrText);
    if (parsed) {
      classes = [...parsed.classes];
      id = parsed.id;
    }
  }

  // Check for include directive — skip entirely
  if (classes.includes("include")) {
    return "";
  }

  const classAttr = classes.length > 0
    ? ` class="${classes.map(escapeHtml).join(" ")}"`
    : "";
  const idAttr = id ? ` id="${escapeHtml(id)}"` : "";

  // Parse title
  const titleNode = node.getChild("FencedDivTitle");
  const title = titleNode
    ? ctx.doc.slice(titleNode.from, titleNode.to).trim()
    : "";

  // Check if self-closing (has two FencedDivFence children on the same line)
  const fences = node.getChildren("FencedDivFence");
  const isSelfClosing = fences.length >= 2 &&
    !ctx.doc.slice(fences[0].from, fences[fences.length - 1].to).includes("\n");

  const output: string[] = [];
  output.push(`<div${classAttr}${idAttr}>`);

  if (title) {
    if (isSelfClosing) {
      output.push(`<p>${renderInline(title, ctx.macros)}</p>`);
    } else {
      output.push(`<strong class="div-title">${renderInline(title, ctx.macros)}</strong>`);
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
      output.push(innerParts.join("\n"));
    }
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

  return `<div class="math-display">${renderMath(latex, true, ctx.macros)}</div>`;
}

/** Render a FootnoteDef node. */
function renderFootnoteDef(node: SyntaxNode, ctx: WalkContext): string {
  const labelNode = node.getChild("FootnoteDefLabel");
  if (!labelNode) return "";

  const labelText = ctx.doc.slice(labelNode.from, labelNode.to);
  // Label text is like "[^1]:" — extract the id
  const match = /^\[\^([^\]]+)\]:?$/.exec(labelText);
  if (!match) return "";

  const fnId = escapeHtml(match[1]);
  // Content is everything after the label
  const contentStart = labelNode.to;
  const rawContent = ctx.doc.slice(contentStart, node.to).trim();
  const fnContent = renderInline(rawContent, ctx.macros);

  return `<div class="footnote" id="fn-${fnId}"><sup>${fnId}</sup> ${fnContent}</div>`;
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
      const content = renderChildren(cells[c], ctx.doc, ctx.macros);
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

/** Render a Blockquote node (kept for safety, though removed from parser). */
function renderBlockquote(node: SyntaxNode, ctx: WalkContext): string {
  const innerHtml = renderDocChildren(node, ctx);
  return `<blockquote>${innerHtml}</blockquote>`;
}

// ── Inline content rendering ────────────────────────────────────────────────

/** Set of node names that are "marks" (delimiters) to skip. */
const MARK_NODES = new Set([
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

/**
 * Render the inline children of a node (e.g., Paragraph, Emphasis).
 *
 * Walks the node's children, rendering inline elements and collecting
 * plain text between them. Text gaps between children are escaped.
 *
 * When `rangeFrom`/`rangeTo` are provided, only children and text within
 * that range are rendered (used by renderLinkText to extract [text] portion).
 */
function renderChildren(
  node: SyntaxNode,
  doc: string,
  macros?: Record<string, string>,
  rangeFrom?: number,
  rangeTo?: number,
): string {
  const from = rangeFrom ?? node.from;
  const to = rangeTo ?? node.to;
  const parts: string[] = [];
  let pos = from;
  let child = node.firstChild;

  while (child) {
    // Only process children within the range
    if (child.to > from && child.from < to) {
      // Text gap between previous position and this child
      if (child.from > pos) {
        parts.push(escapeHtml(doc.slice(pos, child.from)));
      }

      const childHtml = renderInlineNode(child, doc, macros);
      if (childHtml !== null) {
        parts.push(childHtml);
      }

      pos = child.to;
    }
    child = child.nextSibling;
  }

  // Trailing text after last child
  if (pos < to) {
    parts.push(escapeHtml(doc.slice(pos, to)));
  }

  return parts.join("");
}

/**
 * Render a single inline node. Returns HTML string, or null if the node
 * should be skipped (marks).
 */
function renderInlineNode(
  node: SyntaxNode,
  doc: string,
  macros?: Record<string, string>,
): string | null {
  // Skip delimiter marks
  if (MARK_NODES.has(node.name)) {
    return null;
  }

  switch (node.name) {
    case "Emphasis":
      return `<em>${renderChildren(node, doc, macros)}</em>`;

    case "StrongEmphasis":
      return `<strong>${renderChildren(node, doc, macros)}</strong>`;

    case "Strikethrough":
      return `<del>${renderChildren(node, doc, macros)}</del>`;

    case "Highlight":
      return `<mark>${renderChildren(node, doc, macros)}</mark>`;

    case "InlineCode": {
      // Get code text between the CodeMark delimiters
      const marks = node.getChildren("CodeMark");
      if (marks.length >= 2) {
        const code = doc.slice(marks[0].to, marks[marks.length - 1].from);
        return `<code>${escapeHtml(code)}</code>`;
      }
      return `<code>${escapeHtml(doc.slice(node.from, node.to))}</code>`;
    }

    case "InlineMath": {
      const marks = node.getChildren("InlineMathMark");
      if (marks.length >= 2) {
        const latex = doc.slice(marks[0].to, marks[marks.length - 1].from);
        return renderMath(latex, false, macros);
      }
      return escapeHtml(doc.slice(node.from, node.to));
    }

    case "Link": {
      return renderLink(node, doc, macros);
    }

    case "Image": {
      return renderImage(node, doc);
    }

    case "FootnoteRef": {
      // FootnoteRef text is [^id]
      const refText = doc.slice(node.from, node.to);
      const match = /^\[\^([^\]]+)\]$/.exec(refText);
      if (match) {
        const fnId = escapeHtml(match[1]);
        return `<sup><a class="footnote-ref" href="#fn-${fnId}">${fnId}</a></sup>`;
      }
      return escapeHtml(refText);
    }

    case "HardBreak":
      return "<br>";

    case "URL":
      // URL nodes inside links are handled by renderLink
      return null;

    default:
      // Unknown inline node — render its text
      return escapeHtml(doc.slice(node.from, node.to));
  }
}

/** Render a Link node, handling cross-references ([@id]). */
function renderLink(
  node: SyntaxNode,
  doc: string,
  macros?: Record<string, string>,
): string {
  const fullText = doc.slice(node.from, node.to);

  // Cross-reference: [@id] — Lezer parses this as a Link
  const crossRefMatch = /^\[@([^\]]+)\]$/.exec(fullText);
  if (crossRefMatch) {
    const ref = escapeHtml(crossRefMatch[1]);
    return `<a class="cross-ref" href="#${ref}">${ref}</a>`;
  }

  // Regular link: [text](url)
  const urlNode = node.getChild("URL");
  if (!urlNode) {
    // No URL child — just render text
    return renderChildren(node, doc, macros);
  }

  const rawHref = doc.slice(urlNode.from, urlNode.to);
  const linkText = renderLinkText(node, doc, macros);

  if (isSafeUrl(rawHref)) {
    return `<a href="${escapeHtml(rawHref)}">${linkText}</a>`;
  }
  return `<span class="unsafe-link">${linkText}</span>`;
}

/** Render the text portion of a Link node (between [ and ]). */
function renderLinkText(
  node: SyntaxNode,
  doc: string,
  macros?: Record<string, string>,
): string {
  // Link text is between the first LinkMark "[" and the second LinkMark "]"
  const marks = node.getChildren("LinkMark");
  if (marks.length < 2) return escapeHtml(doc.slice(node.from, node.to));

  const textFrom = marks[0].to;
  const textTo = marks[1].from;
  if (textTo <= textFrom) return "";

  return renderChildren(node, doc, macros, textFrom, textTo);
}

/** Render an Image node. */
function renderImage(node: SyntaxNode, doc: string): string {
  const urlNode = node.getChild("URL");
  if (!urlNode) return "";

  const rawSrc = doc.slice(urlNode.from, urlNode.to);

  // Alt text is between ![ and ]
  const marks = node.getChildren("LinkMark");
  let alt = "";
  if (marks.length >= 2) {
    alt = doc.slice(marks[0].to, marks[1].from);
  }

  if (isSafeUrl(rawSrc)) {
    return `<img src="${escapeHtml(rawSrc)}" alt="${escapeHtml(alt)}">`;
  }
  return `<span class="unsafe-link">[image: ${escapeHtml(alt)}]</span>`;
}
