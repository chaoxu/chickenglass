import { type EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { isCodeFenceStructureEditActive } from "../state/cm-structure-edit";
import { findFencedBlockAt } from "../fenced-block/model";
import {
  type CodeBlockInfo,
  collectCodeBlocks,
} from "../state/code-block-structure";
import { getLineElement } from "./fenced-block-core";
import { editorFocusField } from "./focus-state";

class CodeBlockHoverPlugin {
  private hoveredBlockOpenFence: number | null = null;
  private hoveredHeaderEl: HTMLElement | null = null;
  /**
   * Cached code-block list, rebuilt only when the state changes.
   * Avoids a full syntax-tree scan on every mousemove event.
   */
  private cachedBlocks: readonly CodeBlockInfo[] = [];
  private cachedBlocksState: EditorState | null = null;

  constructor(private readonly view: EditorView) {
    this.cachedBlocks = collectCodeBlocks(view.state);
    this.cachedBlocksState = view.state;
  }

  update(update: ViewUpdate): void {
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

    let pos: number;
    try {
      pos = this.view.posAtDOM(lineEl, 0);
    } catch (_error) {
      // DOM node may be detached after a view update; clear the stale hover.
      this.clearHoveredHeader();
      return;
    }

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
    if (!focused || isCodeFenceStructureEditActive(this.view.state, block)) {
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

export const codeBlockHoverPlugin: Extension = ViewPlugin.fromClass(CodeBlockHoverPlugin, {
  eventHandlers: {
    mousemove(event) {
      this.handleMouseMove(event);
    },
    mouseleave() {
      this.handleMouseLeave();
    },
  },
});
