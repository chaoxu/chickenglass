/**
 * Markdown-to-HTML converter for export.
 *
 * Converts Pandoc-flavored markdown to semantic HTML with:
 * - Headings, paragraphs, lists (ordered, unordered, task lists)
 * - Inline formatting: bold, italic, strikethrough, highlight, inline code
 * - Math rendering via KaTeX (inline and display)
 * - Fenced div blocks as semantic `<div>` elements
 * - Code blocks with language classes
 * - Blockquotes, horizontal rules, tables
 * - Footnotes
 *
 * This is a line-oriented parser — not a full AST transform — designed
 * specifically for the export path where we need standalone HTML.
 */

import katex from "katex";
import { extractDivClass } from "../parser/fenced-div-attrs";

// ── Inline rendering ─────────────────────────────────────────────────────────

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
  // Block known dangerous schemes
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
    // KaTeX render failed (e.g. unsupported command) — show raw LaTeX as error
    const escaped = escapeHtml(latex);
    return displayMode
      ? `<pre class="math-error">${escaped}</pre>`
      : `<code class="math-error">${escaped}</code>`;
  }
}

/**
 * Process inline markdown formatting within a line of text.
 *
 * Handles: inline math ($..$ and \(..\)), bold, italic, strikethrough,
 * highlight, inline code, links, and images.
 *
 * @param macros - Optional KaTeX macros from frontmatter for math rendering.
 */
export function renderInline(
  text: string,
  macros?: Record<string, string>,
): string {
  let result = "";
  let i = 0;

  while (i < text.length) {
    // Inline math: \(...\)
    if (text[i] === "\\" && text[i + 1] === "(") {
      const closeIdx = text.indexOf("\\)", i + 2);
      if (closeIdx !== -1) {
        const latex = text.slice(i + 2, closeIdx);
        result += renderMath(latex, false, macros);
        i = closeIdx + 2;
        continue;
      }
    }

    // Inline math: $...$ (not $$)
    if (text[i] === "$" && text[i + 1] !== "$") {
      const closeIdx = findClosingDollar(text, i + 1);
      if (closeIdx !== -1) {
        const latex = text.slice(i + 1, closeIdx);
        result += renderMath(latex, false, macros);
        i = closeIdx + 1;
        continue;
      }
    }

    // Inline code: `...`
    if (text[i] === "`") {
      const closeIdx = text.indexOf("`", i + 1);
      if (closeIdx !== -1) {
        const code = escapeHtml(text.slice(i + 1, closeIdx));
        result += `<code>${code}</code>`;
        i = closeIdx + 1;
        continue;
      }
    }

    // Strikethrough: ~~...~~
    if (text[i] === "~" && text[i + 1] === "~") {
      const closeIdx = text.indexOf("~~", i + 2);
      if (closeIdx !== -1) {
        const inner = renderInline(text.slice(i + 2, closeIdx), macros);
        result += `<del>${inner}</del>`;
        i = closeIdx + 2;
        continue;
      }
    }

    // Highlight: ==...==
    if (text[i] === "=" && text[i + 1] === "=") {
      const closeIdx = text.indexOf("==", i + 2);
      if (closeIdx !== -1) {
        const inner = renderInline(text.slice(i + 2, closeIdx), macros);
        result += `<mark>${inner}</mark>`;
        i = closeIdx + 2;
        continue;
      }
    }

    // Bold: **...**
    if (text[i] === "*" && text[i + 1] === "*") {
      const closeIdx = text.indexOf("**", i + 2);
      if (closeIdx !== -1) {
        const inner = renderInline(text.slice(i + 2, closeIdx), macros);
        result += `<strong>${inner}</strong>`;
        i = closeIdx + 2;
        continue;
      }
    }

    // Italic: *...*
    if (text[i] === "*" && text[i + 1] !== "*") {
      const closeIdx = findClosingStar(text, i + 1);
      if (closeIdx !== -1) {
        const inner = renderInline(text.slice(i + 1, closeIdx), macros);
        result += `<em>${inner}</em>`;
        i = closeIdx + 1;
        continue;
      }
    }

    // Image: ![alt](url)
    if (text[i] === "!" && text[i + 1] === "[") {
      const match = text.slice(i).match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (match) {
        const alt = escapeHtml(match[1]);
        const rawSrc = match[2];
        if (isSafeUrl(rawSrc)) {
          result += `<img src="${escapeHtml(rawSrc)}" alt="${alt}">`;
        } else {
          result += `<span class="unsafe-link">[image: ${alt}]</span>`;
        }
        i += match[0].length;
        continue;
      }
    }

    // Link: [text](url)
    if (text[i] === "[") {
      // Footnote callout: [^id]
      const fnMatch = text.slice(i).match(/^\[\^([^\]]+)\]/);
      if (fnMatch && text[i + 1] === "^") {
        const fnId = escapeHtml(fnMatch[1]);
        result += `<sup><a class="footnote-ref" href="#fn-${fnId}">${fnId}</a></sup>`;
        i += fnMatch[0].length;
        continue;
      }

      const match = text.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        const linkText = renderInline(match[1], macros);
        const rawHref = match[2];
        if (isSafeUrl(rawHref)) {
          result += `<a href="${escapeHtml(rawHref)}">${linkText}</a>`;
        } else {
          result += `<span class="unsafe-link">${linkText}</span>`;
        }
        i += match[0].length;
        continue;
      }
    }

    // Cross-reference: [@id]
    if (text[i] === "[" && text[i + 1] === "@") {
      const closeIdx = text.indexOf("]", i + 2);
      if (closeIdx !== -1) {
        const ref = escapeHtml(text.slice(i + 2, closeIdx));
        result += `<a class="cross-ref" href="#${ref}">${ref}</a>`;
        i = closeIdx + 1;
        continue;
      }
    }

    // Bare citation: @id (not preceded by [)
    if (text[i] === "@" && i > 0 && text[i - 1] !== "[" && /[a-zA-Z]/.test(text[i + 1] ?? "")) {
      const match = text.slice(i).match(/^@([a-zA-Z][\w-]*)/);
      if (match) {
        const ref = escapeHtml(match[1]);
        result += `<a class="cross-ref" href="#${ref}">${ref}</a>`;
        i += match[0].length;
        continue;
      }
    }

    // Default: escape and append character
    result += escapeHtml(text[i]);
    i++;
  }

  return result;
}

/** Find closing $ that isn't escaped, skipping whitespace-adjacent dollars. */
function findClosingDollar(text: string, start: number): number {
  // Opening $ must not be followed by whitespace
  if (start >= text.length || /\s/.test(text[start])) return -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "$" && text[i - 1] !== "\\" && !/\s/.test(text[i - 1])) {
      return i;
    }
  }
  return -1;
}

/** Find closing * for italic that isn't part of **. */
function findClosingStar(text: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    if (text[i] === "*" && text[i + 1] !== "*" && (i === 0 || text[i - 1] !== "*")) {
      return i;
    }
  }
  return -1;
}

// ── Block-level parsing ──────────────────────────────────────────────────────

/**
 * Parse the attribute block and title from a fenced div opening line.
 *
 * Reuses the existing `extractDivClass` parser for attribute extraction,
 * and additionally extracts the title text that follows the attributes.
 */
function parseDivAttrs(
  line: string,
): { classes: string[]; id: string | undefined; title: string } | undefined {
  // Match ::: {.class #id} Title or ::: ClassName Title
  const colonMatch = line.match(/^:{3,}\s*(.*)/);
  if (!colonMatch) return undefined;
  const rest = colonMatch[1].trim();
  if (!rest) return undefined;

  // Remove trailing ::: for self-closing divs
  const cleaned = rest.replace(/\s*:{3,}\s*$/, "").trim();

  // Split attribute part from title
  let attrPart: string;
  let title: string;

  if (cleaned.startsWith("{")) {
    const braceEnd = cleaned.indexOf("}");
    if (braceEnd === -1) return undefined;
    attrPart = cleaned.slice(0, braceEnd + 1);
    title = cleaned.slice(braceEnd + 1).trim();
  } else {
    // Short form: first word is the class name, rest is title
    const spaceIdx = cleaned.indexOf(" ");
    if (spaceIdx === -1) {
      attrPart = cleaned;
      title = "";
    } else {
      attrPart = cleaned.slice(0, spaceIdx);
      title = cleaned.slice(spaceIdx + 1).trim();
    }
  }

  const attrs = extractDivClass(attrPart);
  if (!attrs) return undefined;

  return { classes: [...attrs.classes], id: attrs.id, title };
}

/** Check if a line is an include directive. */
function isIncludeDirective(line: string): boolean {
  return /^:{3,}\s*\{\.include\}/.test(line.trim());
}

/** Options for the markdown-to-HTML converter. */
export interface MarkdownToHtmlOptions {
  /** KaTeX macros from frontmatter for math rendering. */
  macros?: Record<string, string>;
  /** When true, add hierarchical section numbers to headings. */
  sectionNumbers?: boolean;
  /** Shared heading counters for recursive calls (internal use). */
  _counters?: number[];
}

/**
 * Convert markdown content to semantic HTML body content.
 *
 * This is the main conversion function. It processes the markdown
 * line-by-line, handling block structures (headings, lists, code blocks,
 * fenced divs, blockquotes, tables, horizontal rules) and delegates
 * inline formatting to `renderInline`.
 *
 * @param options - Optional configuration for macros and section numbers.
 */
export function markdownToHtml(
  content: string,
  options?: MarkdownToHtmlOptions,
): string {
  const macros = options?.macros;
  const sectionNumbers = options?.sectionNumbers ?? false;
  const headingCounters = options?._counters ?? [0, 0, 0, 0, 0, 0, 0];
  const lines = content.split("\n");
  const output: string[] = [];
  let i = 0;

  // Skip YAML frontmatter (must have a closing --- with content between)
  if (lines[0]?.trim() === "---") {
    let fmEnd = 1;
    while (fmEnd < lines.length && lines[fmEnd].trim() !== "---") fmEnd++;
    // Only skip if we found a closing --- and there's content between
    if (fmEnd < lines.length && fmEnd > 1) {
      i = fmEnd + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line
    if (trimmed === "") {
      i++;
      continue;
    }

    // Skip include directives and their content
    if (isIncludeDirective(trimmed)) {
      i++;
      // Skip content until closing :::
      while (i < lines.length && !/^:{3,}\s*$/.test(lines[i].trim())) i++;
      if (i < lines.length) i++; // skip closing :::
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      output.push("<hr>");
      i++;
      continue;
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      // Strip trailing attribute blocks {.class #id -} for display
      const rawText = headingMatch[2].replace(/\s*\{[^}]*\}\s*$/, "");
      const isUnnumbered = /\{[^}]*(?:-|\.unnumbered)[^}]*\}\s*$/.test(headingMatch[2]);
      const text = renderInline(rawText, macros);

      let prefix = "";
      if (sectionNumbers && !isUnnumbered) {
        headingCounters[level]++;
        for (let lv = level + 1; lv <= 6; lv++) headingCounters[lv] = 0;
        const parts: number[] = [];
        for (let lv = 1; lv <= level; lv++) parts.push(headingCounters[lv]);
        prefix = `<span class="cg-section-number">${parts.join(".")}</span> `;
      }
      output.push(`<h${level}>${prefix}${text}</h${level}>`);
      i++;
      continue;
    }

    // Display math: $$ ... $$ (possibly multi-line)
    if (trimmed.startsWith("$$")) {
      const mathLines: string[] = [];
      const firstLine = trimmed.slice(2).trim();

      // Check for single-line display math: $$ ... $$
      const singleLineClose = firstLine.indexOf("$$");
      if (singleLineClose !== -1 && firstLine.length > 2) {
        const latex = firstLine.slice(0, singleLineClose).trim();
        output.push(`<div class="math-display">${renderMath(latex, true, macros)}</div>`);
        i++;
        continue;
      }

      if (firstLine && !firstLine.startsWith("$$")) {
        mathLines.push(firstLine);
      }
      i++;
      while (i < lines.length) {
        const ml = lines[i].trim();
        // Closing $$ possibly with equation label {#eq:...}
        if (ml.startsWith("$$") || ml.match(/^\$\$\s*\{#eq:/)) {
          break;
        }
        mathLines.push(lines[i]);
        i++;
      }
      // Skip closing $$ line (and any equation label)
      if (i < lines.length) i++;

      const latex = mathLines.join("\n").trim();
      output.push(`<div class="math-display">${renderMath(latex, true, macros)}</div>`);
      continue;
    }

    // Display math: \[...\] (multi-line)
    if (trimmed.startsWith("\\[")) {
      const mathLines: string[] = [];
      const firstLine = trimmed.slice(2).trim();
      if (firstLine && !firstLine.startsWith("\\]")) {
        mathLines.push(firstLine);
      }
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("\\]")) {
        mathLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing \]
      const latex = mathLines.join("\n").trim();
      output.push(`<div class="math-display">${renderMath(latex, true, macros)}</div>`);
      continue;
    }

    // Fenced code block
    const codeMatch = trimmed.match(/^(`{3,})(.*)/);
    if (codeMatch) {
      const fence = codeMatch[1];
      const lang = codeMatch[2].trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      const code = escapeHtml(codeLines.join("\n"));
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      output.push(`<pre><code${langAttr}>${code}</code></pre>`);
      continue;
    }

    // Fenced div: ::: {.class} Title ... :::
    const divAttrs = parseDivAttrs(trimmed);
    if (divAttrs) {
      // Check for self-closing div (trailing ::: on same line)
      const isSelfClosing = /:{3,}\s*$/.test(line) && /:{3,}.*:{3,}/.test(trimmed);

      const classAttr = divAttrs.classes.length > 0
        ? ` class="${divAttrs.classes.map(escapeHtml).join(" ")}"`
        : "";
      const idAttr = divAttrs.id ? ` id="${escapeHtml(divAttrs.id)}"` : "";

      if (isSelfClosing) {
        // Self-closing: ::: {.class} Content :::
        // The content between attrs and closing ::: is captured as the title.
        output.push(`<div${classAttr}${idAttr}>`);
        if (divAttrs.title) {
          output.push(`<p>${renderInline(divAttrs.title, macros)}</p>`);
        }
        output.push("</div>");
        i++;
        continue;
      }

      output.push(`<div${classAttr}${idAttr}>`);
      if (divAttrs.title) {
        output.push(`<strong class="div-title">${renderInline(divAttrs.title, macros)}</strong>`);
      }
      i++;

      // Collect content until matching closing ::: (respecting nesting depth)
      const innerLines: string[] = [];
      let depth = 1;
      while (i < lines.length && depth > 0) {
        const ln = lines[i].trim();
        // Opening ::: with content (not bare closing)
        if (/^:{3,}\s+\S/.test(ln) || (/^:{3,}\s*\{/.test(ln) && !/^:{3,}\s*$/.test(ln))) {
          depth++;
        }
        // Bare closing :::
        if (/^:{3,}\s*$/.test(ln)) {
          depth--;
          if (depth === 0) {
            i++; // skip closing :::
            break;
          }
        }
        innerLines.push(lines[i]);
        i++;
      }

      // Recursively render inner content (share heading counters)
      const innerHtml = markdownToHtml(innerLines.join("\n"), {
        ...options,
        _counters: headingCounters,
      });
      output.push(innerHtml);
      output.push("</div>");
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ") || trimmed === ">") {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const ql = lines[i].trim();
        if (ql.startsWith("> ") || ql === ">") {
          quoteLines.push(ql.slice(2));
          i++;
        } else if (ql === "") {
          // Empty line may continue blockquote if next line is also >
          if (i + 1 < lines.length && lines[i + 1].trim().startsWith(">")) {
            quoteLines.push("");
            i++;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      const quoteHtml = markdownToHtml(quoteLines.join("\n"), options);
      output.push(`<blockquote>${quoteHtml}</blockquote>`);
      continue;
    }

    // Table
    if (trimmed.includes("|") && i + 1 < lines.length && /^\|?\s*:?-+:?\s*\|/.test(lines[i + 1]?.trim() ?? "")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      output.push(renderTable(tableLines, macros));
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(trimmed)) {
      const listResult = parseList(lines, i, "ul", macros);
      output.push(listResult.html);
      i = listResult.nextIndex;
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const listResult = parseList(lines, i, "ol", macros);
      output.push(listResult.html);
      i = listResult.nextIndex;
      continue;
    }

    // Footnote definition: [^id]: content
    const footnoteMatch = trimmed.match(/^\[\^([^\]]+)\]:\s*(.*)/);
    if (footnoteMatch) {
      const fnId = escapeHtml(footnoteMatch[1]);
      const fnContent = renderInline(footnoteMatch[2], macros);
      output.push(
        `<div class="footnote" id="fn-${fnId}">` +
        `<sup>${fnId}</sup> ${fnContent}</div>`,
      );
      i++;
      continue;
    }

    // Paragraph (default)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("$$") &&
      !lines[i].trim().startsWith("\\[") &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith(":::") &&
      !lines[i].trim().startsWith("> ") &&
      !/^[-*+]\s/.test(lines[i].trim()) &&
      !/^\d+\.\s/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !/^\[\^[^\]]+\]:/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      const paraText = renderInline(paraLines.join(" "), macros);
      output.push(`<p>${paraText}</p>`);
    }
  }

  return output.join("\n");
}

// ── List parsing ─────────────────────────────────────────────────────────────

interface ListParseResult {
  html: string;
  nextIndex: number;
}

/**
 * Parse a list (ordered or unordered) starting at the given index.
 * Handles nested lists and task list items.
 */
function parseList(
  lines: string[],
  startIndex: number,
  type: "ul" | "ol",
  macros?: Record<string, string>,
): ListParseResult {
  const items: string[] = [];
  let i = startIndex;
  const listPattern = type === "ul" ? /^[-*+]\s/ : /^\d+\.\s/;
  const itemPattern = type === "ul" ? /^[-*+]\s(.*)/ : /^\d+\.\s(.*)/;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Check for list item at current level
    const itemMatch = trimmed.match(itemPattern);
    if (itemMatch) {
      let itemContent = itemMatch[1];

      // Collect continuation lines (indented by 2+ spaces)
      i++;
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        (lines[i].startsWith("  ") || lines[i].startsWith("\t")) &&
        !listPattern.test(lines[i].trim())
      ) {
        itemContent += " " + lines[i].trim();
        i++;
      }

      // Check for nested list
      if (
        i < lines.length &&
        (lines[i].startsWith("  ") || lines[i].startsWith("\t")) &&
        (/^[-*+]\s/.test(lines[i].trim()) || /^\d+\.\s/.test(lines[i].trim()))
      ) {
        const nestedType = /^\d+\.\s/.test(lines[i].trim()) ? "ol" : "ul";
        const nestedLines: string[] = [];
        while (
          i < lines.length &&
          (lines[i].startsWith("  ") || lines[i].startsWith("\t") || lines[i].trim() === "")
        ) {
          // Dedent by 2 spaces or 1 tab
          const dedented = lines[i].startsWith("  ")
            ? lines[i].slice(2)
            : lines[i].startsWith("\t")
              ? lines[i].slice(1)
              : lines[i];
          nestedLines.push(dedented);
          i++;
          // Stop if we hit a non-indented non-empty line
          if (
            i < lines.length &&
            lines[i].trim() !== "" &&
            !lines[i].startsWith("  ") &&
            !lines[i].startsWith("\t")
          ) {
            break;
          }
        }
        const nestedResult = parseList(nestedLines, 0, nestedType, macros);
        items.push(renderListItem(itemContent, macros) + nestedResult.html);
      } else {
        items.push(renderListItem(itemContent, macros));
      }
      continue;
    }

    // Empty line might continue the list
    if (trimmed === "" && i + 1 < lines.length && listPattern.test(lines[i + 1]?.trim() ?? "")) {
      i++;
      continue;
    }

    break;
  }

  const tag = type;
  const itemsHtml = items.map((item) => `<li>${item}</li>`).join("\n");
  return { html: `<${tag}>\n${itemsHtml}\n</${tag}>`, nextIndex: i };
}

/** Render a list item, handling task list checkboxes. */
function renderListItem(
  content: string,
  macros?: Record<string, string>,
): string {
  // Task list: [x] or [ ]
  const taskMatch = content.match(/^\[([ xX])\]\s*(.*)/);
  if (taskMatch) {
    const checked = taskMatch[1] !== " " ? " checked" : "";
    return `<input type="checkbox" disabled${checked}> ${renderInline(taskMatch[2], macros)}`;
  }
  return renderInline(content, macros);
}

// ── Table rendering ──────────────────────────────────────────────────────────

/** Render a markdown table from its lines. */
function renderTable(
  tableLines: string[],
  macros?: Record<string, string>,
): string {
  if (tableLines.length < 2) return "";

  const parseRow = (row: string): string[] => {
    // Remove leading/trailing pipes and split
    const trimmed = row.replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((cell) => cell.trim());
  };

  // Parse alignment from separator row
  const separatorCells = parseRow(tableLines[1]);
  const alignments = separatorCells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });

  const headerCells = parseRow(tableLines[0]);
  const bodyRows = tableLines.slice(2);

  let html = "<table>\n<thead>\n<tr>\n";
  for (let c = 0; c < headerCells.length; c++) {
    const align = alignments[c] ? ` style="text-align: ${alignments[c]}"` : "";
    html += `<th${align}>${renderInline(headerCells[c], macros)}</th>\n`;
  }
  html += "</tr>\n</thead>\n<tbody>\n";

  for (const row of bodyRows) {
    const cells = parseRow(row);
    html += "<tr>\n";
    for (let c = 0; c < cells.length; c++) {
      const align = alignments[c] ? ` style="text-align: ${alignments[c]}"` : "";
      html += `<td${align}>${renderInline(cells[c] ?? "", macros)}</td>\n`;
    }
    html += "</tr>\n";
  }

  html += "</tbody>\n</table>";
  return html;
}
