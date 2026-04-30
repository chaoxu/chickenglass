import type { EditorState, Range } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { CSS } from "../constants/css-classes";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../document-surface-classes";
import { findTrailingHeadingAttributes } from "../semantics/heading-ancestry";
import {
  addMarkerReplacement,
  decorationHidden,
} from "./decoration-core";
import {
  getLinkDecoration,
} from "./link-handler";
import { addInlineRevealSourceMetricsInSubtree } from "./markdown-inline-source";
import { cursorInRange } from "./node-collection";

/** Heading mark decorations (font-weight, text styling on spans). */
const headingMarkByLevel: Record<string, Decoration> = {
  ATXHeading1: Decoration.mark({ class: "cf-heading-1" }),
  ATXHeading2: Decoration.mark({ class: "cf-heading-2" }),
  ATXHeading3: Decoration.mark({ class: "cf-heading-3" }),
  ATXHeading4: Decoration.mark({ class: "cf-heading-4" }),
  ATXHeading5: Decoration.mark({ class: "cf-heading-5" }),
  ATXHeading6: Decoration.mark({ class: "cf-heading-6" }),
};

/**
 * Heading line decorations (font-size on .cm-line).
 * Font-size lives here so ALL children (including math widgets) inherit it,
 * rather than only text spans wrapped by Decoration.mark.
 */
const headingLineByLevel: Record<string, Decoration> = {
  ATXHeading1: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(1),
      "cf-heading-line-1",
    ),
  }),
  ATXHeading2: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(2),
      "cf-heading-line-2",
    ),
  }),
  ATXHeading3: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(3),
      "cf-heading-line-3",
    ),
  }),
  ATXHeading4: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(4),
      "cf-heading-line-4",
    ),
  }),
  ATXHeading5: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(5),
      "cf-heading-line-5",
    ),
  }),
  ATXHeading6: Decoration.line({
    class: documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.heading,
      DOCUMENT_SURFACE_CLASS.headingLevel(6),
      "cf-heading-line-6",
    ),
  }),
};

const highlightDecoration = Decoration.mark({ class: "cf-highlight" });
const boldDecoration = Decoration.mark({ class: CSS.bold });
const italicDecoration = Decoration.mark({ class: CSS.italic });
const strikethroughDecoration = Decoration.mark({ class: CSS.strikethrough });
const inlineCodeDecoration = Decoration.mark({ class: CSS.inlineCode });
const numberListDecoration = Decoration.mark({ class: CSS.listNumber });

const styleMap: Readonly<Record<string, Decoration>> = {
  StrongEmphasis: boldDecoration,
  Emphasis: italicDecoration,
  Strikethrough: strikethroughDecoration,
  InlineCode: inlineCodeDecoration,
};

class HorizontalRuleWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cf-hr";
    hr.setAttribute("aria-hidden", "true");
    return hr;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof HorizontalRuleWidget;
  }
}

class BulletListMarkerWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = CSS.listBullet;
    span.textContent = "•";
    return span;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof BulletListMarkerWidget;
  }
}

const bulletListMarkerWidget = new BulletListMarkerWidget();

function cursorInMarkdownRange(
  state: EditorState,
  focused: boolean,
  from: number,
  to: number,
): boolean {
  return focused && cursorInRange(state, from, to);
}

/** Shared mutable context passed to handlers during tree iteration. */
export interface MarkdownHandlerContext {
  readonly state: EditorState;
  readonly focused: boolean;
  readonly items: Range<Decoration>[];
  /** Set by ATXHeading handler, read by HeaderMark handler. */
  cursorInHeading: boolean;
}

/** Entry in the markdown node handler registry. */
export interface MarkdownNodeHandler {
  /** Whether this node toggles rendering based on cursor proximity. */
  readonly cursorSensitive: boolean;
  /**
   * Handle a matching node. Return value follows Lezer enter() semantics:
   * undefined = walk children, false = skip children.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: CM6-style callback convention; false means skip, void means continue
  readonly handle: (node: SyntaxNodeRef, ctx: MarkdownHandlerContext) => false | void;
}

function handleHeading(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  const { state, focused, items } = ctx;
  const headingMark = headingMarkByLevel[node.name];
  if (headingMark) {
    items.push(headingMark.range(node.from, node.to));
  }
  const headingLine = headingLineByLevel[node.name];
  if (headingLine) {
    const line = state.doc.lineAt(node.from);
    items.push(headingLine.range(line.from));
  }

  ctx.cursorInHeading = cursorInMarkdownRange(state, focused, node.from, node.to);

  if (!ctx.cursorInHeading) {
    const hLine = state.doc.lineAt(node.from);
    const attrMatch = findTrailingHeadingAttributes(hLine.text);
    if (attrMatch) {
      const attrFrom = hLine.from + attrMatch.index;
      const attrTo = attrFrom + attrMatch.raw.length;
      items.push(decorationHidden.range(attrFrom, attrTo));
    }
  }
}

function handleHeaderMark(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  const { state, items } = ctx;
  const end = node.to;
  const docLen = state.doc.length;
  const nextChar = end < docLen ? state.sliceDoc(end, end + 1) : "";
  const hideEnd = nextChar === " " ? end + 1 : end;
  addMarkerReplacement(node.from, hideEnd, ctx.cursorInHeading, null, items);
}

function handleHighlight(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  let contentFrom = node.from;
  let contentTo = node.to;
  let firstMarkTo: number | undefined;
  let lastMarkFrom: number | undefined;
  let cursor = node.node.firstChild;
  while (cursor) {
    if (cursor.name === "HighlightMark") {
      firstMarkTo ??= cursor.to;
      lastMarkFrom = cursor.from;
    }
    cursor = cursor.nextSibling;
  }
  if (firstMarkTo !== undefined && lastMarkFrom !== undefined) {
    contentFrom = firstMarkTo;
    contentTo = lastMarkFrom;
  }
  if (contentFrom < contentTo) {
    ctx.items.push(highlightDecoration.range(contentFrom, contentTo));
  }
  if (cursorInMarkdownRange(ctx.state, ctx.focused, node.from, node.to)) {
    addInlineRevealSourceMetricsInSubtree(node.node, ctx.items);
    return false as const;
  }
}

function handleLink(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  const { state, focused, items } = ctx;
  if (cursorInMarkdownRange(state, focused, node.from, node.to)) {
    addInlineRevealSourceMetricsInSubtree(node.node, items);
    return false as const;
  }

  const linkNode = node.node;
  const urlChild = linkNode.getChild("URL");
  if (!urlChild) {
    return false as const;
  }
  const url = state.sliceDoc(urlChild.from, urlChild.to);
  const marks: { from: number; to: number }[] = [];
  let cursor = linkNode.firstChild;
  while (cursor) {
    if (cursor.name === "LinkMark") {
      marks.push({ from: cursor.from, to: cursor.to });
    }
    cursor = cursor.nextSibling;
  }
  if (marks.length >= 2) {
    const textFrom = marks[0].to;
    const textTo = marks[1].from;
    if (textFrom < textTo) {
      items.push(getLinkDecoration(url).range(textFrom, textTo));
    }
  }
}

function handleUrl(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  const parentName = node.node.parent?.name;
  if (parentName === "Link") {
    ctx.items.push(decorationHidden.range(node.from, node.to));
    return;
  }
  if (parentName !== "Autolink") return undefined;
  if (cursorInMarkdownRange(ctx.state, ctx.focused, node.from, node.to)) {
    return false as const;
  }
  const url = ctx.state.sliceDoc(node.from, node.to);
  ctx.items.push(getLinkDecoration(url).range(node.from, node.to));
}

function handleElement(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  const { state, focused, items } = ctx;
  const styleDeco = styleMap[node.name];
  if (styleDeco) {
    items.push(styleDeco.range(node.from, node.to));
  }

  if (cursorInMarkdownRange(state, focused, node.from, node.to)) {
    addInlineRevealSourceMetricsInSubtree(node.node, items);
    return false as const;
  }
}

function handleFencedCode() {
  return false as const;
}

function handleHidden(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  ctx.items.push(decorationHidden.range(node.from, node.to));
}

function handleHorizontalRule(node: SyntaxNodeRef, ctx: MarkdownHandlerContext) {
  if (cursorInMarkdownRange(ctx.state, ctx.focused, node.from, node.to)) {
    return false as const;
  }
  ctx.items.push(
    Decoration.replace({
      widget: new HorizontalRuleWidget(),
    }).range(node.from, node.to),
  );
}

function handleEscape(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  if (cursorInMarkdownRange(ctx.state, ctx.focused, node.from, node.to)) return;
  ctx.items.push(Decoration.replace({}).range(node.from, node.from + 1));
}

function handleListMark(node: SyntaxNodeRef, ctx: MarkdownHandlerContext): void {
  const grandparent = node.node.parent?.parent?.name;
  if (grandparent === "BulletList") {
    ctx.items.push(
      Decoration.replace({ widget: bulletListMarkerWidget }).range(node.from, node.to),
    );
    return;
  }

  ctx.items.push(numberListDecoration.range(node.from, node.to));
}

export const MARKDOWN_HANDLERS = new Map<string, MarkdownNodeHandler>();

for (const name of Object.keys(headingMarkByLevel)) {
  MARKDOWN_HANDLERS.set(name, { cursorSensitive: true, handle: handleHeading });
}
MARKDOWN_HANDLERS.set("HeaderMark", { cursorSensitive: false, handle: handleHeaderMark });
MARKDOWN_HANDLERS.set("Highlight", { cursorSensitive: true, handle: handleHighlight });
MARKDOWN_HANDLERS.set("Link", { cursorSensitive: true, handle: handleLink });
for (const name of ["Emphasis", "StrongEmphasis", "InlineCode", "Image", "Strikethrough"]) {
  MARKDOWN_HANDLERS.set(name, { cursorSensitive: true, handle: handleElement });
}
MARKDOWN_HANDLERS.set("FencedCode", { cursorSensitive: false, handle: handleFencedCode });
for (const name of ["EmphasisMark", "CodeMark", "LinkMark", "LinkLabel", "HardBreak", "StrikethroughMark", "HighlightMark"]) {
  MARKDOWN_HANDLERS.set(name, { cursorSensitive: false, handle: handleHidden });
}
MARKDOWN_HANDLERS.set("URL", { cursorSensitive: true, handle: handleUrl });
MARKDOWN_HANDLERS.set("HorizontalRule", { cursorSensitive: true, handle: handleHorizontalRule });
MARKDOWN_HANDLERS.set("LinkReference", { cursorSensitive: false, handle: () => false });
MARKDOWN_HANDLERS.set("Escape", { cursorSensitive: true, handle: handleEscape });
MARKDOWN_HANDLERS.set("ListMark", { cursorSensitive: false, handle: handleListMark });

export const CURSOR_SENSITIVE_NODES = new Set(
  [...MARKDOWN_HANDLERS].filter(([, h]) => h.cursorSensitive).map(([name]) => name),
);
