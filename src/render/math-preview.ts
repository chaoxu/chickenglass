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
import { autoUpdate, type VirtualElement } from "@floating-ui/dom";
import { CSS } from "../constants";
import { findActiveMath, renderKatex, resolveClickToSourcePos } from "./math-render";
import { mathMacrosField } from "./math-macros";
import {
  createPreviewSurfaceContent,
  createPreviewSurfaceShell,
} from "../preview-surface";
import { documentAnalysisField } from "../semantics/codemirror-source";

interface MathRegionSnapshot {
  latex: string;
  contentFrom: number;
  from: number;
  to: number;
}

interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface PositionMeasurement {
  requestId: number;
  rect: AnchorRect;
}

const EMPTY_ANCHOR_RECT: AnchorRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

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
  private positionPollId: number | null = null;
  private lastAnchorRect: AnchorRect = EMPTY_ANCHOR_RECT;
  private readonly autoUpdateAnchor: VirtualElement;

  constructor(private view: EditorView) {
    const plugin = this;
    this.autoUpdateAnchor = {
      getBoundingClientRect: () => plugin.readAnchorRect() ?? plugin.lastAnchorRect,
      get contextElement() {
        return plugin.view.contentDOM;
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
    this.requestPositionUpdate();
    this.startPositionPolling();
  }

  private createPanel(): void {
    const panel = createPreviewSurfaceShell(CSS.mathPreview);

    // Panel itself is draggable
    panel.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.stopPositionPolling();
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
      if (!this.manualPosition) {
        this.startPositionPolling();
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // Clicking rendered math in the preview navigates to the source position
    const content = createPreviewSurfaceContent(CSS.mathPreviewContent);
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
    const onScroll = () => {
      this.requestPositionUpdate();
    };
    this.view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    const cleanupFloating = autoUpdate(this.autoUpdateAnchor, this.panel, () => {
      this.requestPositionUpdate();
    });
    this.cleanupAutoUpdate = () => {
      this.view.scrollDOM.removeEventListener("scroll", onScroll);
      cleanupFloating();
    };
  }

  private startPositionPolling(): void {
    if (!this.panel || this.manualPosition || this.isDragging || this.positionPollId !== null) {
      return;
    }

    this.positionPollId = window.setInterval(() => {
      this.syncPositionFromAnchor();
    }, 16);
  }

  private stopPositionPolling(): void {
    if (this.positionPollId === null) return;
    window.clearInterval(this.positionPollId);
    this.positionPollId = null;
  }

  private readAnchorRect(): AnchorRect | null {
    if (this.anchorFromPos < 0 || this.anchorToPos < 0) return null;

    try {
      // Anchor to the inline math span itself on both edges. Leaving the side
      // implicit lets coordsAtPos fall back to adjacent content at boundaries.
      const fromCoords = this.view.coordsAtPos(this.anchorFromPos, 1);
      const toCoords = this.view.coordsAtPos(this.anchorToPos, -1);
      if (!fromCoords || !toCoords) return null;

      return {
        x: fromCoords.left,
        y: fromCoords.top,
        width: Math.max(toCoords.right - fromCoords.left, 0),
        height: Math.max(toCoords.bottom - fromCoords.top, 0),
        top: fromCoords.top,
        right: toCoords.right,
        bottom: toCoords.bottom,
        left: fromCoords.left,
      };
    } catch {
      return null;
    }
  }

  private syncPositionFromAnchor(): void {
    if (!this.panel || this.isDragging || this.manualPosition) return;
    const rect = this.readAnchorRect();
    if (!rect) return;

    this.lastAnchorRect = rect;
    this.panel.style.left = `${rect.left}px`;
    this.panel.style.top = `${rect.bottom + 4}px`;
  }

  private requestPositionUpdate(): void {
    if (!this.panel || this.isDragging || this.manualPosition) return;
    const requestId = ++this.positionRequestId;
    this.view.requestMeasure({
      key: "cf-math-preview-pos",
      read: () => {
        if (requestId !== this.positionRequestId) return null;
        const rect = this.readAnchorRect();
        if (!rect) return null;

        return {
          requestId,
          rect,
        } satisfies PositionMeasurement;
      },
      write: (measurement) => {
        if (!measurement || !this.panel || this.isDragging || this.manualPosition) return;
        if (measurement.requestId !== this.positionRequestId) return;

        this.lastAnchorRect = measurement.rect;
        this.panel.style.left = `${measurement.rect.left}px`;
        this.panel.style.top = `${measurement.rect.bottom + 4}px`;
      },
    });
  }

  private renderLatex(latex: string, isDisplay: boolean): void {
    if (!this.contentEl) return;
    const macros = this.view.state.field(mathMacrosField);
    renderKatex(this.contentEl, latex, isDisplay, macros);
  }

  private removePanel(): void {
    this.positionRequestId += 1;
    this.lastAnchorRect = EMPTY_ANCHOR_RECT;
    this.stopPositionPolling();
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
