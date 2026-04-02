/**
 * Math preview modal.
 *
 * Shows a floating panel with a live KaTeX preview when the cursor
 * is inside an InlineMath or DisplayMath node. The panel is draggable
 * via its title bar and has a close button.
 */

import {
  type EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { autoUpdate, computePosition, offset, type VirtualElement } from "@floating-ui/dom";
import { findActiveMath, renderKatex, resolveClickToSourcePos } from "./math-render";
import { mathMacrosField } from "./math-macros";
import { documentAnalysisField } from "../semantics/codemirror-source";

interface MathRegionSnapshot {
  latex: string;
  contentFrom: number;
  from: number;
  to: number;
}

class MathPreviewPlugin implements PluginValue {
  private panel: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private cleanupListeners: (() => void) | null = null;
  private cleanupAutoUpdate: (() => void) | null = null;
  private lastRaw = "";
  private lastRegion: MathRegionSnapshot | null = null;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private manualPosition: { left: number; top: number } | null = null;
  private anchorFromPos = -1;
  private anchorToPos = -1;
  private positionRequestId = 0;
  private readonly autoUpdateAnchor: VirtualElement;

  constructor(private view: EditorView) {
    const plugin = this;
    this.autoUpdateAnchor = {
      getBoundingClientRect: () => plugin.getAnchorRect() ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      get contextElement() {
        return plugin.view.scrollDOM;
      },
    };
    this.scheduleCheck();
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.state.field(documentAnalysisField).mathRegions !==
        update.startState.field(documentAnalysisField).mathRegions
    ) {
      this.scheduleCheck({ resetManualPosition: true });
    }
  }

  destroy(): void {
    this.removePanel();
  }

  private scheduleCheck(options: { resetManualPosition?: boolean } = {}): void {
    if (!this.view.hasFocus) {
      this.removePanel();
      return;
    }

    const regions = this.view.state.field(documentAnalysisField).mathRegions;
    const info = findActiveMath(regions, this.view.state.selection.main);

    if (!info || info.isDisplay) {
      this.removePanel();
      return;
    }

    const raw = this.view.state.sliceDoc(info.from, info.to);

    if (!this.panel) {
      this.createPanel();
    }

    if (options.resetManualPosition) {
      this.manualPosition = null;
    }

    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      this.lastRegion = {
        latex: info.latex,
        contentFrom: info.contentFrom,
        from: info.from,
        to: info.to,
      };
      this.renderLatex(info.latex, info.isDisplay);
    }

    this.anchorFromPos = info.from;
    this.anchorToPos = info.to;
    this.startAutoUpdate();
    this.updatePosition();
  }

  private createPanel(): void {
    const panel = document.createElement("div");
    panel.className = "cf-math-preview";

    // Panel itself is draggable
    panel.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      const rect = panel.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging || !this.panel) return;
      const left = e.clientX - this.dragOffsetX;
      const top = e.clientY - this.dragOffsetY;
      this.manualPosition = { left, top };
      this.panel.style.left = `${left}px`;
      this.panel.style.top = `${top}px`;
    };

    const onMouseUp = () => {
      this.isDragging = false;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // Clicking rendered math in the preview navigates to the source position
    const content = document.createElement("div");
    content.className = "cf-math-preview-content";
    content.style.cursor = "pointer";
    content.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const r = this.lastRegion;
      if (!r) return;

      const contentOffset = r.contentFrom - r.from;
      const pos = resolveClickToSourcePos(
        content, e, r.latex, r.from, r.to, contentOffset,
      );
      this.view.focus();
      this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    });
    panel.appendChild(content);

    this.contentEl = content;
    this.panel = panel;
    this.lastRaw = "";

    // Store cleanup for document-level listeners
    this.cleanupListeners = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    this.view.dom.appendChild(panel);
  }

  private startAutoUpdate(): void {
    if (!this.panel || this.cleanupAutoUpdate) return;
    this.cleanupAutoUpdate = autoUpdate(this.autoUpdateAnchor, this.panel, () => {
      this.updatePosition();
    });
  }

  private getAnchorRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  } | null {
    if (this.anchorFromPos < 0 || this.anchorToPos < 0) return null;
    const fromCoords = this.view.coordsAtPos(this.anchorFromPos);
    const toCoords = this.view.coordsAtPos(this.anchorToPos);
    if (!fromCoords || !toCoords) return null;

    return {
      x: fromCoords.left,
      y: fromCoords.top,
      width: 0,
      height: Math.max(toCoords.bottom - fromCoords.top, 0),
      top: fromCoords.top,
      right: fromCoords.left,
      bottom: toCoords.bottom,
      left: fromCoords.left,
    };
  }

  private updatePosition(): void {
    if (!this.panel || this.isDragging || this.manualPosition) return;

    const anchorRect = this.getAnchorRect();
    if (!anchorRect) return;

    const panel = this.panel;
    const requestId = ++this.positionRequestId;
    const anchor: VirtualElement = {
      contextElement: this.view.scrollDOM,
      getBoundingClientRect: () => anchorRect,
    };

    void computePosition(anchor, panel, {
      placement: "bottom-start",
      strategy: "fixed",
      middleware: [offset(4)],
    }).then(({ x, y }) => {
      if (
        requestId !== this.positionRequestId ||
        panel !== this.panel ||
        this.isDragging ||
        this.manualPosition
      ) {
        return;
      }

      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    });
  }

  private renderLatex(latex: string, isDisplay: boolean): void {
    if (!this.contentEl) return;
    const macros = this.view.state.field(mathMacrosField);
    renderKatex(this.contentEl, latex, isDisplay, macros);
  }

  private removePanel(): void {
    this.positionRequestId += 1;
    this.cleanupAutoUpdate?.();
    this.cleanupAutoUpdate = null;
    this.cleanupListeners?.();
    this.cleanupListeners = null;
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
    this.contentEl = null;
    this.lastRaw = "";
    this.lastRegion = null;
    this.manualPosition = null;
    this.anchorFromPos = -1;
    this.anchorToPos = -1;
  }
}

/** CM6 extension that shows a floating KaTeX preview when editing math. */
export const mathPreviewPlugin: Extension = ViewPlugin.fromClass(
  MathPreviewPlugin,
);
