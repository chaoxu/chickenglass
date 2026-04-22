import type { SyntaxNode } from "@lezer/common";
import { readBracedLabelId } from "../../parser/label-utils";
import { BLOCK_MANIFEST_ENTRIES, EXCLUDED_FROM_FALLBACK } from "../../constants/block-manifest";
import { CSS } from "../../constants/css-classes";
import { capitalize } from "../../lib/utils";
import { escapeHtml, renderMath, type InlineContext, type WalkContext } from "./shared";
import { renderChildren, renderDocumentInline, renderInlineWithSurface } from "./inline";

export function renderNode(node: SyntaxNode, context: WalkContext): string {
  switch (node.name) {
    case "Document":
      return renderDocument(node, context);
    case "Paragraph":
      return `<p>${renderChildren(node, context)}</p>`;
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
      return renderHeading(node, context);
    case "FencedCode":
      return renderFencedCode(node, context);
    case "BulletList":
      return renderList(node, context, "ul");
    case "OrderedList":
      return renderList(node, context, "ol");
    case "HorizontalRule":
      return "<hr>";
    case "FencedDiv":
      return renderFencedDiv(node, context);
    case "DisplayMath":
      return renderDisplayMath(node, context);
    case "FootnoteDef":
      return renderFootnoteDef(node, context);
    case "Table":
      return renderTable(node, context);
    case "Blockquote":
      return renderBlockquote(node, context);
    default:
      return renderDocChildren(node, context);
  }
}

function renderDocument(node: SyntaxNode, context: WalkContext): string {
  const output: string[] = [];
  let child = node.firstChild;

  if (context.doc.startsWith("---")) {
    const firstNewline = context.doc.indexOf("\n");
    if (firstNewline !== -1) {
      const afterFirstLine = context.doc.slice(3, firstNewline).trim();
      if (afterFirstLine.length === 0) {
        const closingIndex = context.doc.indexOf("\n---", firstNewline);
        if (closingIndex !== -1) {
          const frontmatterEnd = closingIndex + 4;
          while (child && child.to <= frontmatterEnd) {
            child = child.nextSibling;
          }
          if (child && child.from < frontmatterEnd) {
            child = child.nextSibling;
          }
        }
      }
    }
  }

  while (child) {
    const html = renderNode(child, context);
    if (html) output.push(html);
    child = child.nextSibling;
  }

  return output.join("\n");
}

function renderDocChildren(node: SyntaxNode, context: WalkContext): string {
  const output: string[] = [];
  let child = node.firstChild;
  while (child) {
    const html = renderNode(child, context);
    if (html) output.push(html);
    child = child.nextSibling;
  }
  return output.join("\n");
}

function renderHeading(node: SyntaxNode, context: WalkContext): string {
  const heading = context.semantics.headingByFrom.get(node.from);
  const fallbackLevel = Number(node.name[node.name.length - 1]);
  const renderedText = renderDocumentInline(
    heading?.text ?? context.doc.slice(node.from, node.to).trim(),
    context,
  );
  const prefix = context.sectionNumbers && heading?.number
    ? `<span class="${CSS.sectionNumber}">${heading.number}</span> `
    : "";
  const level = heading?.level ?? fallbackLevel;

  return `<h${level}>${prefix}${renderedText}</h${level}>`;
}

function renderFencedCode(node: SyntaxNode, context: WalkContext): string {
  const codeInfo = node.getChild("CodeInfo");
  const language = codeInfo ? context.doc.slice(codeInfo.from, codeInfo.to).trim() : "";
  const codeText = node.getChild("CodeText");
  const code = codeText ? escapeHtml(context.doc.slice(codeText.from, codeText.to)) : "";
  const langAttr = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre><code${langAttr}>${code}</code></pre>`;
}

function renderList(
  node: SyntaxNode,
  context: WalkContext,
  tag: "ul" | "ol",
): string {
  const items: string[] = [];
  let child = node.firstChild;

  while (child) {
    if (child.name === "ListItem") {
      items.push(renderListItem(child, context));
    }
    child = child.nextSibling;
  }

  const itemsHtml = items.map((item) => `<li>${item}</li>`).join("\n");
  return `<${tag}>\n${itemsHtml}\n</${tag}>`;
}

function renderListItem(node: SyntaxNode, context: WalkContext): string {
  const parts: string[] = [];
  let child = node.firstChild;

  while (child) {
    if (child.name === "ListMark") {
      child = child.nextSibling;
      continue;
    }

    if (child.name === "Task") {
      const taskMarker = child.getChild("TaskMarker");
      if (taskMarker) {
        const markerText = context.doc.slice(taskMarker.from, taskMarker.to);
        const checked = markerText !== "[ ]" ? " checked" : "";
        parts.push(`<input type="checkbox" disabled${checked}>`);
      }
      const contentStart = taskMarker ? taskMarker.to + 1 : child.from;
      const taskContent = context.doc.slice(contentStart, child.to).trim();
      parts.push(renderInlineWithSurface(taskContent, documentBodyInlineContext(taskContent, context)));
      child = child.nextSibling;
      continue;
    }

    if (child.name === "Paragraph") {
      parts.push(renderChildren(child, context));
      child = child.nextSibling;
      continue;
    }

    const html = renderNode(child, context);
    if (html) parts.push(html);
    child = child.nextSibling;
  }

  return parts.join(" ");
}

function renderFencedDiv(node: SyntaxNode, context: WalkContext): string {
  const fencedDiv = context.semantics.fencedDivByFrom.get(node.from);
  const classes = fencedDiv ? [...fencedDiv.classes] : [];
  const id = fencedDiv?.id;

  if (classes.some((className) => EXCLUDED_FROM_FALLBACK.has(className))) {
    return "";
  }

  const blockClasses = classes.length > 0
    ? ["cf-block", ...classes.map((className) => `cf-block-${className}`)]
    : [];
  const classAttr = blockClasses.length > 0
    ? ` class="${blockClasses.map(escapeHtml).join(" ")}"`
    : "";
  const idAttr = id ? ` id="${escapeHtml(id)}"` : "";

  const title = fencedDiv?.title ?? "";
  const isSelfClosing = fencedDiv?.isSelfClosing ?? false;
  const primaryClass = BLOCK_MANIFEST_ENTRIES.find((entry) => classes.includes(entry.name));
  const captionBelow = primaryClass?.captionPosition === "below";
  const inlineHeader = primaryClass?.headerPosition === "inline";
  const headerLabel = escapeHtml(primaryClass?.title ?? capitalize(primaryClass?.name ?? ""));

  const output: string[] = [];
  output.push(`<div${classAttr}${idAttr}>`);

  if (title) {
    if (isSelfClosing) {
      output.push(`<p>${renderDocumentInline(title, context)}</p>`);
    } else if (!captionBelow && !inlineHeader) {
      output.push(`<strong class="${CSS.blockHeaderRendered}">${renderDocumentInline(title, context)}</strong>`);
    }
  }

  if (!isSelfClosing) {
    const innerParts: string[] = [];
    let child = node.firstChild;
    while (child) {
      if (
        child.name !== "FencedDivFence" &&
        child.name !== "FencedDivAttributes" &&
        child.name !== "FencedDivTitle"
      ) {
        const html = renderNode(child, context);
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
      `<div class="cf-block-caption"><span class="${CSS.blockHeaderRendered}">${captionLabel}</span><span class="cf-block-caption-text">${renderDocumentInline(title, context)}</span></div>`,
    );
  }

  output.push("</div>");
  return output.join("\n");
}

function renderDisplayMath(node: SyntaxNode, context: WalkContext): string {
  const marks = node.getChildren("DisplayMathMark");
  let latex = "";

  if (marks.length >= 2) {
    const afterOpen = marks[0].to;
    const beforeClose = marks[marks.length - 1].from;
    if (beforeClose > afterOpen) {
      latex = context.doc.slice(afterOpen, beforeClose).trim();
    }
  } else if (marks.length === 1) {
    latex = context.doc.slice(marks[0].to, node.to).trim();
  }

  const equationLabel = node.getChild("EquationLabel");
  const equationId = equationLabel
    ? readBracedLabelId(context.doc, equationLabel.from, equationLabel.to, "eq:")
    : null;
  const equationNumber = equationId
    ? context.semantics.equationById.get(equationId)?.number
    : undefined;
  const mathHtml = renderMath(latex, true, context.macros);

  if (equationNumber === undefined) {
    return `<div class="${CSS.mathDisplay}">${mathHtml}</div>`;
  }

  return `<div class="${CSS.mathDisplay} ${CSS.mathDisplayNumbered}"><div class="${CSS.mathDisplayContent}">${mathHtml}</div><span class="${CSS.mathDisplayNumber}">(${equationNumber})</span></div>`;
}

function renderFootnoteDef(node: SyntaxNode, context: WalkContext): string {
  const footnote = context.semantics.footnotes.defByFrom.get(node.from);
  if (!footnote) return "";

  const content = footnote.content
    ? `<p>${renderInlineWithSurface(footnote.content, documentBodyInlineContext(footnote.content, context))}</p>`
    : "";

  return `<div class="footnote" id="fn-${escapeHtml(footnote.id)}"><sup>${escapeHtml(footnote.id)}</sup> ${content}</div>`;
}

function documentBodyInlineContext(
  doc: string,
  context: WalkContext,
): Pick<
  InlineContext,
  | "doc"
  | "macros"
  | "bibliography"
  | "citedIds"
  | "nextCitationOccurrence"
  | "cslProcessor"
  | "blockCounters"
  | "surface"
  | "semantics"
  | "documentPath"
  | "imageUrlOverrides"
> {
  return {
    doc,
    macros: context.macros,
    bibliography: context.bibliography,
    citedIds: context.citedIds,
    nextCitationOccurrence: context.nextCitationOccurrence,
    cslProcessor: context.cslProcessor,
    blockCounters: context.blockCounters,
    surface: "document-body",
    semantics: context.semantics,
    documentPath: context.documentPath,
    imageUrlOverrides: context.imageUrlOverrides,
  };
}

function renderTable(node: SyntaxNode, context: WalkContext): string {
  const delimiterNode = node.getChild("TableDelimiter");
  if (!delimiterNode) return "";

  const alignments = parseTableAlignments(context.doc.slice(delimiterNode.from, delimiterNode.to));
  const renderRow = (cells: readonly SyntaxNode[], tag: "th" | "td"): string => {
    let row = "";
    for (let index = 0; index < cells.length; index += 1) {
      const align = alignments[index] ? ` style="text-align: ${alignments[index]}"` : "";
      const content = renderChildren(cells[index], context);
      row += `<${tag}${align}>${content}</${tag}>\n`;
    }
    return row;
  };

  const headerNode = node.getChild("TableHeader");
  let html = "<table>\n<thead>\n<tr>\n";
  if (headerNode) {
    html += renderRow(headerNode.getChildren("TableCell"), "th");
  }
  html += "</tr>\n</thead>\n<tbody>\n";

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

export function parseTableAlignments(delimiterRow: string): string[] {
  const cells = delimiterRow
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

function renderBlockquote(node: SyntaxNode, context: WalkContext): string {
  return `<blockquote>${renderDocChildren(node, context)}</blockquote>`;
}
