import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import {
  collectCitationMatches,
  registerCitationsWithProcessor,
  type CslProcessor,
} from "../citations/csl-processor";
import {
  BLOCK_MANIFEST_ENTRIES,
  EXCLUDED_FROM_FALLBACK,
  getManifestBlockTitle,
  type BlockManifestEntry,
} from "../constants/block-manifest";
import { CSS } from "../constants/css-classes";
import type { ReferenceClassification, ResolvedCrossref } from "../index/crossref-resolver";
import { isRelativeFilePath } from "../lib/pdf-target";
import { resolveProjectPathFromDocument } from "../lib/project-paths";
import type { BlockCounterEntry } from "../lib/types";
import {
  extractRawFrontmatter,
  htmlRenderExtensions,
  type FrontmatterConfig,
} from "../parser";
import { readBracedLabelId } from "../parser/label-utils";
import {
  analyzeDocumentSemantics,
  stringTextSource,
  type DocumentSemantics,
} from "../semantics/document";
import {
  formatBlockReferenceLabel,
  formatEquationReferenceLabel,
  formatHeadingReferenceLabel,
} from "../semantics/reference-catalog";
import type { BibStore } from "../state/bib-data";
import {
  renderInlineMarkdown,
  renderInlineSyntaxNodeToDom,
  type InlineReferenceRenderContext,
} from "./inline-render";
import { renderKatex } from "./math-widget";

export interface PreviewBlockRenderOptions {
  readonly macros?: Record<string, string>;
  readonly config?: FrontmatterConfig;
  readonly bibliography?: BibStore;
  readonly cslProcessor?: CslProcessor;
  readonly blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  readonly documentPath?: string;
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
  readonly referenceSemantics?: DocumentSemantics;
}

interface PreviewRenderContext {
  readonly doc: string;
  readonly macros: Record<string, string>;
  readonly semantics: DocumentSemantics;
  readonly referenceSemantics: DocumentSemantics;
  readonly bibliography?: BibStore;
  readonly cslProcessor?: CslProcessor;
  readonly blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  readonly documentPath?: string;
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
  readonly referenceContext: InlineReferenceRenderContext;
}

const previewParser = baseParser.configure(htmlRenderExtensions);

export function renderPreviewBlockContentToDom(
  container: HTMLElement,
  text: string,
  options: PreviewBlockRenderOptions = {},
): void {
  container.textContent = "";

  const tree = previewParser.parse(text);
  const semantics = analyzeDocumentSemantics(stringTextSource(text), tree);
  const referenceSemantics = options.referenceSemantics ?? semantics;

  registerPreviewCitations(semantics, {
    ...options,
    referenceSemantics,
  });

  const context: PreviewRenderContext = {
    doc: text,
    macros: options.macros ?? options.config?.math ?? {},
    semantics,
    referenceSemantics,
    bibliography: options.bibliography,
    cslProcessor: options.cslProcessor,
    blockCounters: options.blockCounters,
    documentPath: options.documentPath,
    imageUrlOverrides: options.imageUrlOverrides,
    referenceContext: buildReferenceContext({
      ...options,
      referenceSemantics,
      semantics,
    }),
  };

  renderNode(container, tree.topNode, context);
  applyImageOverrides(container, context);
}

function registerPreviewCitations(
  semantics: DocumentSemantics,
  options: PreviewBlockRenderOptions,
): void {
  if (!options.bibliography || !options.cslProcessor) return;

  const matches = collectCitationMatches(semantics.references, options.bibliography, {
    isLocalTarget: (id) => hasLocalCrossrefTarget(id, options),
  });
  registerCitationsWithProcessor(matches, options.cslProcessor);
}

function buildReferenceContext(
  options: PreviewBlockRenderOptions & {
    readonly semantics: DocumentSemantics;
    readonly referenceSemantics: DocumentSemantics;
  },
): InlineReferenceRenderContext {
  return {
    classify(id: string): ReferenceClassification {
      const resolved = resolvePreviewCrossref(id, options);
      if (resolved) {
        return { kind: "crossref", resolved };
      }
      if (options.bibliography?.has(id)) {
        return { kind: "citation", id };
      }
      return { kind: "unresolved", id };
    },
    cite(ids, locators) {
      if (options.cslProcessor) {
        const rendered = options.cslProcessor.cite([...ids], [...locators]);
        if (rendered) return rendered;
      }
      return `(${ids.map((id, index) => locators[index] ? `${id}, ${locators[index]}` : id).join("; ")})`;
    },
    citeNarrative(id) {
      if (options.cslProcessor && options.bibliography?.has(id)) {
        return options.cslProcessor.citeNarrative(id);
      }
      return id;
    },
  };
}

function resolvePreviewCrossref(
  id: string,
  options: Pick<PreviewBlockRenderOptions, "blockCounters"> & {
    readonly referenceSemantics?: DocumentSemantics;
  },
): ResolvedCrossref | null {
  const block = options.blockCounters?.get(id);
  if (block) {
    return {
      kind: "block",
      label: formatBlockReferenceLabel(block.title, block.number),
      number: block.number,
    };
  }

  const semantics = options.referenceSemantics;
  const equation = semantics?.equationById.get(id);
  if (equation) {
    return {
      kind: "equation",
      label: formatEquationReferenceLabel(equation.number),
      number: equation.number,
    };
  }

  const heading = semantics?.headings.find((entry) => entry.id === id);
  if (heading) {
    return {
      kind: "heading",
      label: formatHeadingReferenceLabel(heading),
      title: heading.text,
    };
  }

  return null;
}

function hasLocalCrossrefTarget(
  id: string,
  options: Pick<PreviewBlockRenderOptions, "blockCounters" | "referenceSemantics">,
): boolean {
  if (options.blockCounters?.has(id)) return true;
  const semantics = options.referenceSemantics;
  if (!semantics) return false;
  if (semantics.equationById.has(id)) return true;
  return semantics.headings.some((heading) => heading.id === id);
}

function renderNode(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  switch (node.name) {
    case "Document":
      renderDocument(parent, node, context);
      return;
    case "Paragraph":
      renderParagraph(parent, node, context);
      return;
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
      renderHeading(parent, node, context);
      return;
    case "FencedCode":
      renderFencedCode(parent, node, context);
      return;
    case "BulletList":
      renderList(parent, node, context, "ul");
      return;
    case "OrderedList":
      renderList(parent, node, context, "ol");
      return;
    case "HorizontalRule":
      parent.appendChild(document.createElement("hr"));
      return;
    case "FencedDiv":
      renderFencedDiv(parent, node, context);
      return;
    case "DisplayMath":
      renderDisplayMath(parent, node, context);
      return;
    case "FootnoteDef":
      renderFootnoteDef(parent, node, context);
      return;
    case "Table":
      renderTable(parent, node, context);
      return;
    case "Blockquote":
      renderBlockquote(parent, node, context);
      return;
    default:
      renderChildNodes(parent, node, context);
      return;
  }
}

function renderDocument(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  let child = node.firstChild;
  const frontmatterEnd = extractRawFrontmatter(context.doc)?.end ?? -1;

  if (frontmatterEnd >= 0) {
    while (child && child.to <= frontmatterEnd) {
      child = child.nextSibling;
    }
    if (child && child.from < frontmatterEnd) {
      child = child.nextSibling;
    }
  }

  while (child) {
    renderNode(parent, child, context);
    child = child.nextSibling;
  }
}

function renderChildNodes(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  let child = node.firstChild;
  while (child) {
    renderNode(parent, child, context);
    child = child.nextSibling;
  }
}

function renderParagraph(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const paragraph = document.createElement("p");
  appendInlineNode(paragraph, node, context);
  parent.appendChild(paragraph);
}

function renderHeading(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const heading = context.semantics.headingByFrom.get(node.from);
  const fallbackLevel = Number(node.name[node.name.length - 1]);
  const level = heading?.level ?? fallbackLevel;
  const element = document.createElement(`h${level}`) as HTMLHeadingElement;

  if (heading?.id) {
    element.id = heading.id;
  }
  renderInlineMarkdown(
    element,
    heading?.text ?? context.doc.slice(node.from, node.to).replace(/^#{1,6}\s*/, "").trim(),
    context.macros,
    "document-body",
    context.referenceContext,
  );
  parent.appendChild(element);
}

function renderFencedCode(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  const codeInfo = node.getChild("CodeInfo");
  const language = codeInfo ? context.doc.slice(codeInfo.from, codeInfo.to).trim() : "";
  const codeText = node.getChild("CodeText");

  if (language) {
    const languageToken = language.split(/\s+/)[0] ?? "";
    if (/^[A-Za-z0-9_-]+$/.test(languageToken)) {
      code.classList.add(`language-${languageToken}`);
    }
  }
  code.textContent = codeText ? context.doc.slice(codeText.from, codeText.to) : "";
  pre.appendChild(code);
  parent.appendChild(pre);
}

function renderList(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
  tag: "ul" | "ol",
): void {
  const list = document.createElement(tag);
  const loose = isLooseList(node, context.doc);
  let child = node.firstChild;

  while (child) {
    if (child.name === "ListItem") {
      const item = document.createElement("li");
      renderListItem(item, child, context, loose);
      list.appendChild(item);
    }
    child = child.nextSibling;
  }

  parent.appendChild(list);
}

function isLooseList(node: SyntaxNode, doc: string): boolean {
  let item = node.firstChild;
  while (item) {
    if (item.name === "ListItem" && isLooseListItem(item, doc)) return true;
    item = item.nextSibling;
  }
  return false;
}

function isLooseListItem(node: SyntaxNode, doc: string): boolean {
  let paragraphCount = 0;
  let previousBlock: SyntaxNode | null = null;
  let child = node.firstChild;

  while (child) {
    if (child.name !== "ListMark") {
      if (previousBlock && hasBlankLineBetween(doc, previousBlock, child)) return true;
      if (child.name === "Paragraph") paragraphCount += 1;
      if (paragraphCount > 1) return true;
      previousBlock = child;
    }
    child = child.nextSibling;
  }

  return false;
}

function hasBlankLineBetween(doc: string, left: SyntaxNode, right: SyntaxNode): boolean {
  return /\r?\n[ \t]*\r?\n/.test(doc.slice(left.to, right.from));
}

function renderListItem(
  parent: HTMLElement,
  node: SyntaxNode,
  context: PreviewRenderContext,
  loose: boolean,
): void {
  let child = node.firstChild;

  while (child) {
    if (child.name === "ListMark") {
      child = child.nextSibling;
      continue;
    }

    if (child.name === "Task") {
      renderTaskListItem(parent, child, context, loose);
      child = child.nextSibling;
      continue;
    }

    if (child.name === "Paragraph") {
      if (loose) {
        renderParagraph(parent, child, context);
      } else {
        appendInlineNode(parent, child, context);
      }
      child = child.nextSibling;
      continue;
    }

    renderNode(parent, child, context);
    child = child.nextSibling;
  }
}

function renderTaskListItem(
  parent: HTMLElement,
  node: SyntaxNode,
  context: PreviewRenderContext,
  loose: boolean,
): void {
  const target = loose ? document.createElement("p") : parent;
  const taskMarker = node.getChild("TaskMarker");
  if (taskMarker) {
    const markerText = context.doc.slice(taskMarker.from, taskMarker.to);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.disabled = true;
    input.checked = markerText !== "[ ]";
    target.appendChild(input);

    const contentStart = Math.min(taskMarker.to + 1, node.to);
    const content = context.doc.slice(contentStart, node.to).trim();
    if (content) {
      target.appendChild(document.createTextNode(" "));
      renderInlineMarkdown(
        target,
        content,
        context.macros,
        "document-body",
        context.referenceContext,
      );
    }
  } else {
    appendInlineNode(target, node, context);
  }

  if (loose) {
    parent.appendChild(target);
  }
}

function renderFencedDiv(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const fencedDiv = context.semantics.fencedDivByFrom.get(node.from);
  const classes = fencedDiv ? [...fencedDiv.classes] : [];
  const id = fencedDiv?.id;

  if (classes.some((className) => EXCLUDED_FROM_FALLBACK.has(className))) {
    return;
  }

  const block = document.createElement("div");
  for (const className of classes) {
    block.classList.add("cf-block", `cf-block-${className}`);
  }
  if (id) {
    block.id = id;
  }

  const title = fencedDiv?.title ?? "";
  const isSelfClosing = fencedDiv?.isSelfClosing ?? false;
  const primaryClass = getPrimaryBlockClass(classes);
  const captionBelow = primaryClass?.captionPosition === "below";
  const inlineHeader = primaryClass?.headerPosition === "inline";
  const headerLabel = getBlockHeaderLabel(primaryClass);

  if (title) {
    if (isSelfClosing) {
      const paragraph = document.createElement("p");
      appendInlineText(paragraph, title, context, "document-body");
      block.appendChild(paragraph);
    } else if (!captionBelow && !inlineHeader) {
      const strong = document.createElement("strong");
      strong.className = CSS.blockHeaderRendered;
      appendInlineText(strong, title, context, "document-body");
      block.appendChild(strong);
    }
  }

  if (!isSelfClosing) {
    const body = document.createDocumentFragment();
    let child = node.firstChild;
    while (child) {
      if (
        child.name !== "FencedDivFence" &&
        child.name !== "FencedDivAttributes" &&
        child.name !== "FencedDivTitle"
      ) {
        renderNode(body, child, context);
      }
      child = child.nextSibling;
    }

    if (inlineHeader) {
      prependInlineHeader(body, headerLabel);
    }
    block.appendChild(body);
  }

  if (!isSelfClosing && captionBelow && title) {
    const caption = document.createElement("div");
    caption.className = "cf-block-caption";

    const label = document.createElement("span");
    label.className = CSS.blockHeaderRendered;
    label.textContent = headerLabel;
    caption.appendChild(label);

    const text = document.createElement("span");
    text.className = "cf-block-caption-text";
    appendInlineText(text, title, context, "document-body");
    caption.appendChild(text);
    block.appendChild(caption);
  }

  parent.appendChild(block);
}

function getPrimaryBlockClass(classes: readonly string[]): BlockManifestEntry | undefined {
  return BLOCK_MANIFEST_ENTRIES.find((entry) => classes.includes(entry.name));
}

function getBlockHeaderLabel(entry: BlockManifestEntry | undefined): string {
  return entry ? getManifestBlockTitle(entry) : "";
}

function prependInlineHeader(body: DocumentFragment, label: string): void {
  if (!label) return;

  const header = document.createElement("span");
  header.className = CSS.blockHeaderRendered;
  header.textContent = label;

  const first = body.firstElementChild;
  if (first instanceof HTMLParagraphElement) {
    first.prepend(header);
    return;
  }

  const paragraph = document.createElement("p");
  paragraph.appendChild(header);
  body.prepend(paragraph);
}

function renderDisplayMath(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
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

  const wrapper = document.createElement("div");
  wrapper.className = equationNumber === undefined
    ? CSS.mathDisplay
    : `${CSS.mathDisplay} ${CSS.mathDisplayNumbered}`;
  if (equationId) {
    wrapper.id = equationId;
  }

  if (equationNumber === undefined) {
    renderKatex(wrapper, latex, true, context.macros);
  } else {
    const content = document.createElement("div");
    content.className = CSS.mathDisplayContent;
    renderKatex(content, latex, true, context.macros);
    wrapper.appendChild(content);

    const number = document.createElement("span");
    number.className = CSS.mathDisplayNumber;
    number.textContent = `(${equationNumber})`;
    wrapper.appendChild(number);
  }

  parent.appendChild(wrapper);
}

function renderFootnoteDef(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const footnote = context.semantics.footnotes.defByFrom.get(node.from);
  if (!footnote) return;

  const block = document.createElement("div");
  block.className = "footnote";
  block.id = `fn-${footnote.id}`;

  const label = document.createElement("sup");
  label.textContent = footnote.id;
  block.appendChild(label);
  block.appendChild(document.createTextNode(" "));

  if (footnote.content) {
    const paragraph = document.createElement("p");
    appendInlineText(paragraph, footnote.content, context, "document-body");
    block.appendChild(paragraph);
  }

  parent.appendChild(block);
}

function renderTable(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const delimiterNode = node.getChild("TableDelimiter");
  if (!delimiterNode) return;

  const alignments = parseTableAlignments(context.doc.slice(delimiterNode.from, delimiterNode.to));
  const headerNode = node.getChild("TableHeader");
  const headerCells = headerNode?.getChildren("TableCell") ?? [];
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  thead.appendChild(renderTableRow(headerCells, "th", alignments, context));

  let child = node.firstChild;
  while (child) {
    if (child.name === "TableRow") {
      tbody.appendChild(renderTableRow(child.getChildren("TableCell"), "td", alignments, context));
    }
    child = child.nextSibling;
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  parent.appendChild(table);
}

function renderTableRow(
  cells: readonly SyntaxNode[],
  tag: "th" | "td",
  alignments: readonly string[],
  context: PreviewRenderContext,
): HTMLTableRowElement {
  const row = document.createElement("tr");
  for (let index = 0; index < alignments.length; index += 1) {
    const cell = document.createElement(tag);
    const align = alignments[index];
    if (align) {
      cell.style.textAlign = align;
    }
    const cellNode = cells[index];
    if (cellNode) {
      appendInlineNode(cell, cellNode, context);
    }
    row.appendChild(cell);
  }
  return row;
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

function renderBlockquote(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const blockquote = document.createElement("blockquote");
  renderChildNodes(blockquote, node, context);
  parent.appendChild(blockquote);
}

function appendInlineNode(
  parent: HTMLElement,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  renderInlineSyntaxNodeToDom(
    parent,
    node,
    context.doc,
    context.macros,
    "document-body",
    context.referenceContext,
  );
}

function appendInlineText(
  parent: HTMLElement,
  text: string,
  context: PreviewRenderContext,
  surface: "document-body" | "document-inline",
): void {
  renderInlineMarkdown(parent, text, context.macros, surface, context.referenceContext);
}

function applyImageOverrides(
  container: HTMLElement,
  context: Pick<PreviewRenderContext, "documentPath" | "imageUrlOverrides">,
): void {
  if (!context.imageUrlOverrides || context.imageUrlOverrides.size === 0) return;

  for (const img of container.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src || !isRelativeFilePath(src)) continue;

    const resolvedPath = resolveProjectPathFromDocument(context.documentPath ?? "", src);
    const override = context.imageUrlOverrides.get(resolvedPath);
    if (override) {
      img.setAttribute("src", override);
    }
  }
}
