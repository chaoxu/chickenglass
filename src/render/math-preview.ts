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
import { autoUpdate, computePosition, offset } from "@floating-ui/dom";
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
  private lastRaw = "";
  private lastRegion: MathRegionSnapshot | null = null;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private cleanupAutoUpdate: (() => void) | null = null;
  /** Document positions of the active math region, read by the virtual element. */
  private measureFromPos = -1;
  private measureToPos = -1;

  constructor(private view: EditorView) {
    this.scheduleCheck();
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.state.field(documentAnalysisField).mathRegions !==
        update.startState.field(documentAnalysisField).mathRegions
    ) {
      this.view = update.view;
      this.scheduleCheck();
    }
  }

  destroy(): void {
    this.removePanel();
  }

  /** Schedule a check after the update cycle completes (layout reads are safe). */
  private scheduleCheck(): void {
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

    // Update anchor positions so the virtual element reads fresh values.
    this.measureFromPos = info.from;
    this.measureToPos = info.to;

    // Start auto-positioning if not already running.  autoUpdate
    // re-invokes computePosition on scroll, resize, and layout shift,
    // keeping the panel anchored to the math region.
    if (!this.cleanupAutoUpdate && this.panel) {
      this.startAutoUpdate();
    }
  }

  /**
   * Set up Floating UI autoUpdate so the panel tracks the math region
   * through scroll, resize, and layout changes.
   */
  private startAutoUpdate(): void {
    // Virtual element: Floating UI reads getBoundingClientRect() on every
    // positioning cycle, so it always gets fresh coordsAtPos values.
    const virtualEl = {
      getBoundingClientRect: () => {
        if (this.measureFromPos < 0) return new DOMRect();
        const from = this.view.coordsAtPos(this.measureFromPos);
        const to = this.view.coordsAtPos(this.measureToPos);
        if (!from || !to) return new DOMRect();
        return new DOMRect(
          from.left,
          from.top,
          to.right - from.left,
          to.bottom - from.top,
        );
      },
    };

    const update = () => {
      if (!this.panel || this.isDragging) return;
      void computePosition(virtualEl, this.panel, {
        placement: "bottom-start",
        middleware: [offset(4)],
      }).then(({ x, y }) => {
        if (!this.panel || this.isDragging) return;
        this.panel.style.left = `${x}px`;
        this.panel.style.top = `${y}px`;
      });
    };

    this.cleanupAutoUpdate = autoUpdate(virtualEl, this.panel!, update);
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
      this.panel.style.left = `${e.clientX - this.dragOffsetX}px`;
      this.panel.style.top = `${e.clientY - this.dragOffsetY}px`;
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

  private renderLatex(latex: string, isDisplay: boolean): void {
    if (!this.contentEl) return;
    const macros = this.view.state.field(mathMacrosField);
    renderKatex(this.contentEl, latex, isDisplay, macros);
  }

  private removePanel(): void {
    if (!this.panel) return;
    this.cleanupAutoUpdate?.();
    this.cleanupAutoUpdate = null;
    this.cleanupListeners?.();
    this.cleanupListeners = null;
    this.panel.remove();
    this.panel = null;
    this.contentEl = null;
    this.lastRaw = "";
    this.lastRegion = null;
    this.measureFromPos = -1;
    this.measureToPos = -1;
  }
}

/** CM6 extension that shows a floating KaTeX preview when editing math. */
export const mathPreviewPlugin: Extension = ViewPlugin.fromClass(
  MathPreviewPlugin,
);
