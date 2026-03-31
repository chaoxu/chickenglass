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
import { findActiveMath, renderKatex } from "./math-render";
import { mathMacrosField } from "./math-macros";
import { documentAnalysisField } from "../semantics/codemirror-source";

class MathPreviewPlugin implements PluginValue {
  private panel: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private cleanupListeners: (() => void) | null = null;
  private lastRaw = "";
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  /** Positions to measure on next requestMeasure cycle. */
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
      this.renderLatex(info.latex, info.isDisplay);
    }

    // Position below the entire math block: left from start, top from end.
    this.measureFromPos = info.from;
    this.measureToPos = info.to;
    this.view.requestMeasure({
      key: "cf-math-preview-pos",
      read: () => {
        if (this.measureFromPos < 0) return null;
        const fromCoords = this.view.coordsAtPos(this.measureFromPos);
        const toCoords = this.view.coordsAtPos(this.measureToPos);
        if (!fromCoords || !toCoords) return null;
        return { left: fromCoords.left, bottom: toCoords.bottom };
      },
      write: (coords) => {
        if (!coords || !this.panel || this.isDragging) return;
        this.panel.style.left = `${coords.left}px`;
        this.panel.style.top = `${coords.bottom + 4}px`;
      },
    });
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

    // Content area
    const content = document.createElement("div");
    content.className = "cf-math-preview-content";
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
    this.cleanupListeners?.();
    this.cleanupListeners = null;
    this.panel.remove();
    this.panel = null;
    this.contentEl = null;
    this.lastRaw = "";
    this.measureFromPos = -1;
    this.measureToPos = -1;
  }
}

/** CM6 extension that shows a floating KaTeX preview when editing math. */
export const mathPreviewPlugin: Extension = ViewPlugin.fromClass(
  MathPreviewPlugin,
);
