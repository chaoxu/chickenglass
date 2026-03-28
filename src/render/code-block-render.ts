/**
 * CM6 decoration provider for fenced code blocks (```lang ... ```).
 *
 * For each FencedCode node in the syntax tree:
 * - When cursor is outside the fence lines: replace the opening fence with a
 *   header widget, hide the closing fence line, and style the block body.
 * - When cursor is on the opening fence line: show the opening fence as source,
 *   keep body rendered.
 * - The closing ``` is ALWAYS hidden (zero height), protected from accidental
 *   deletion by a transaction filter, and skipped by atomicRanges (#429).
 *
 * Closing fence protection and atomic ranges are provided by the unified
 * fenceProtectionExtension in fence-protection.ts (#441).
 *
 * Uses a StateField (not ViewPlugin) so that Decoration.line is permitted
 * by CM6.
 */

import {
  type DecorationSet,
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  EditorState,
  type Extension,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  decorationHidden,
  RenderWidget,
  editorFocusField,
  focusTracker,
  pushWidgetDecoration,
  SimpleTextRenderWidget,
} from "./render-utils";
import {
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
  findFencedBlockAt,
  type FencedBlockInfo,
  getLineElement,
  isCursorOnCloseFence,
  isCursorOnOpenFence,
} from "./fenced-block-core";
import { CSS } from "../constants/css-classes";
import { __iconNode as copyIconNode } from "lucide-react/dist/esm/icons/copy.js";
import { __iconNode as checkIconNode } from "lucide-react/dist/esm/icons/check.js";
import { COPY_RESET_MS } from "../constants";

type IconNode = ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;

function createLucideIcon(iconNode: IconNode): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("xmlns", ns);
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("lucide");

  for (const [tag, attrs] of iconNode) {
    const child = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "key") continue;
      child.setAttribute(name, value);
    }
    svg.appendChild(child);
  }

  return svg;
}

/** Widget that renders a copy-to-clipboard button in the code block header. */
class CopyButtonWidget extends RenderWidget {
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly code: string) {
    super();
  }

  toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "cf-codeblock-copy";
    btn.type = "button";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.appendChild(createLucideIcon(copyIconNode));
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard.writeText(this.code).then(() => {
        btn.replaceChildren(createLucideIcon(checkIconNode));
        btn.setAttribute("aria-label", "Copied");
        if (this.resetTimer !== null) clearTimeout(this.resetTimer);
        this.resetTimer = setTimeout(() => {
          this.resetTimer = null;
          btn.replaceChildren(createLucideIcon(copyIconNode));
          btn.setAttribute("aria-label", "Copy code to clipboard");
        }, COPY_RESET_MS);
      }).catch((e: unknown) => {
        console.error("[code-block] clipboard write failed", e);
      });
    });
    return btn;
  }

  destroy(): void {
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  eq(other: CopyButtonWidget): boolean {
    return this.code === other.code;
  }
}

export interface CodeBlockInfo extends FencedBlockInfo {
  /** Start of the FencedCode node (opening fence line start). */
  readonly from: number;
  /** End of the FencedCode node (closing fence line end). */
  readonly to: number;
  /** Language identifier (empty string if none). */
  readonly language: string;
}

/** Extract info about FencedCode nodes from the syntax tree. */
export function collectCodeBlocks(state: EditorState): CodeBlockInfo[] {
  const results: CodeBlockInfo[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.type.name !== "FencedCode") return;

      // The opening fence line is the first line of the FencedCode node.
      const openLine = state.doc.lineAt(node.from);
      const openFenceFrom = openLine.from;
      const openFenceTo = openLine.to;

      // The closing fence line is the last line of the FencedCode node.
      const closeLine = state.doc.lineAt(node.to);
      const closeFenceFrom = closeLine.from;
      const closeFenceTo = closeLine.to;

      // Extract language from CodeInfo child node.
      let language = "";
      const codeInfoNode = node.node.getChild("CodeInfo");
      if (codeInfoNode) {
        language = state.doc.sliceString(codeInfoNode.from, codeInfoNode.to).trim();
      }

      results.push({
        from: node.from,
        to: node.to,
        openFenceFrom,
        openFenceTo,
        closeFenceFrom,
        closeFenceTo,
        singleLine: closeFenceFrom === openFenceFrom,
        language,
      });
    },
  });

  return results;
}

/** Build decorations for all fenced code blocks. */
function buildCodeBlockDecorations(state: EditorState): DecorationSet {
  return buildFencedBlockDecorations(state, collectCodeBlocks, ({
    state,
    block,
    cursorOnEitherFence,
    openLine,
    closeLine,
    bodyLineCount,
  }, items) => {
    // --- Opening fence ---
    if (cursorOnEitherFence) {
      items.push(
        Decoration.line({ class: CSS.codeblockSourceOpen })
          .range(block.openFenceFrom),
      );
    } else {
      items.push(
        Decoration.line({
          class: CSS.codeblockHeader,
        }).range(block.openFenceFrom),
      );
      const codeText = bodyLineCount > 0
        ? state.doc.sliceString(
          state.doc.line(openLine.number + 1).from,
          state.doc.line(closeLine.number - 1).to,
        )
        : "";
      pushWidgetDecoration(items, new SimpleTextRenderWidget({
        tagName: "span",
        className: CSS.codeblockLanguage,
        text: block.language,
      }), block.openFenceFrom, block.openFenceTo);
      if (bodyLineCount > 0) {
        items.push(
          Decoration.widget({
            widget: new CopyButtonWidget(codeText),
            side: 1,
          }).range(block.openFenceFrom),
        );
      }
    }

    // --- Body lines ---
    for (let ln = openLine.number + 1; ln < closeLine.number; ln++) {
      const line = state.doc.line(ln);
      const isLast = ln === closeLine.number - 1;
      items.push(
        Decoration.line({
          class: !cursorOnEitherFence && isLast ? CSS.codeblockLast : CSS.codeblockBody,
        }).range(line.from),
      );
    }

    if (bodyLineCount === 0 && !cursorOnEitherFence) {
      items.push(
        Decoration.line({ class: CSS.codeblockLast }).range(block.openFenceFrom),
      );
    }

    // --- Closing fence ---
    // Always hidden in rich mode regardless of cursor position (#429).
    // The closing fence is protected from accidental deletion by a
    // transaction filter and skipped by atomicRanges (see below).
    if (!block.singleLine && block.closeFenceFrom >= 0 && block.closeFenceTo > block.closeFenceFrom) {
      items.push(decorationHidden.range(block.closeFenceFrom, block.closeFenceTo));
      items.push(
        Decoration.line({ class: CSS.blockClosingFence }).range(block.closeFenceFrom),
      );
    }
  });
}

class CodeBlockHoverPlugin {
  private hoveredBlockOpenFence: number | null = null;
  private hoveredHeaderEl: HTMLElement | null = null;
  /**
   * Cached code-block list, rebuilt only when the state changes.
   * Avoids a full syntax-tree scan on every mousemove event.
   */
  private cachedBlocks: CodeBlockInfo[] = [];
  private cachedBlocksState: EditorState | null = null;

  constructor(private readonly view: EditorView) {
    this.cachedBlocks = collectCodeBlocks(view.state);
    this.cachedBlocksState = view.state;
  }

  update(update: ViewUpdate): void {
    // Rebuild the block cache whenever something structural changes.
    if (update.docChanged || update.viewportChanged || update.focusChanged) {
      this.cachedBlocks = collectCodeBlocks(update.state);
      this.cachedBlocksState = update.state;
    }
    if (this.hoveredBlockOpenFence === null) return;
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
      this.refreshHoveredHeader();
    }
  }

  destroy(): void {
    this.clearHoveredHeader();
  }

  handleMouseMove(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      this.clearHoveredHeader();
      return;
    }

    const lineEl = target.closest(".cm-line");
    if (!(lineEl instanceof HTMLElement)) {
      this.clearHoveredHeader();
      return;
    }

    // Fast path: if the hovered element is already a header, use it directly.
    // Only look up the block in the cached list (no tree scan on mousemove).
    let pos: number;
    try {
      pos = this.view.posAtDOM(lineEl, 0);
    } catch {
      // best-effort: DOM node may be detached after view update — clear hover state
      this.clearHoveredHeader();
      return;
    }

    // Ensure the cache is current (may lag one frame if update() wasn't called).
    if (this.cachedBlocksState !== this.view.state) {
      this.cachedBlocks = collectCodeBlocks(this.view.state);
      this.cachedBlocksState = this.view.state;
    }

    const block = findFencedBlockAt(this.cachedBlocks, pos);
    if (!block) {
      this.clearHoveredHeader();
      return;
    }

    if (this.hoveredBlockOpenFence !== block.openFenceFrom) {
      this.clearHoveredHeader();
      this.hoveredBlockOpenFence = block.openFenceFrom;
    }
    this.refreshHoveredHeader();
  }

  handleMouseLeave(): void {
    this.clearHoveredHeader();
  }

  private refreshHoveredHeader(): void {
    if (this.hoveredBlockOpenFence === null) return;

    const block = this.cachedBlocks
      .find((candidate) => candidate.openFenceFrom === this.hoveredBlockOpenFence);
    if (!block) {
      this.clearHoveredHeader();
      return;
    }

    const focused = this.view.state.field(editorFocusField, false) ?? false;
    if (isCursorOnOpenFence(this.view.state, block, focused) || isCursorOnCloseFence(this.view.state, block, focused)) {
      this.clearHoveredHeader();
      return;
    }

    const headerEl = getLineElement(this.view, block.openFenceFrom);
    if (!headerEl || !headerEl.classList.contains("cf-codeblock-header")) {
      this.clearHoveredHeader();
      return;
    }

    if (this.hoveredHeaderEl && this.hoveredHeaderEl !== headerEl) {
      this.hoveredHeaderEl.classList.remove("cf-codeblock-hovered");
    }
    this.hoveredHeaderEl = headerEl;
    this.hoveredHeaderEl.classList.add("cf-codeblock-hovered");
  }

  private clearHoveredHeader(): void {
    if (this.hoveredHeaderEl) {
      this.hoveredHeaderEl.classList.remove("cf-codeblock-hovered");
      this.hoveredHeaderEl = null;
    }
    this.hoveredBlockOpenFence = null;
  }
}

/**
 * CM6 StateField that provides code block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) are
 * permitted by CM6.
 */
const codeBlockDecorationField = createFencedBlockDecorationField(buildCodeBlockDecorations);

/** Exported for unit testing decoration logic without a browser. */
export { codeBlockDecorationField as _codeBlockDecorationFieldForTest };

/** CM6 extension that renders fenced code blocks with language label and fence hiding. */
export const codeBlockRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  codeBlockDecorationField,
  // Closing fence protection and atomic ranges are provided by the unified
  // fenceProtectionExtension in fence-protection.ts (#441).
  ViewPlugin.fromClass(CodeBlockHoverPlugin, {
    eventHandlers: {
      mousemove(event) {
        this.handleMouseMove(event);
      },
      mouseleave() {
        this.handleMouseLeave();
      },
    },
  }),
];
