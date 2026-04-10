/**
 * Math preview panel.
 *
 * Shows a live KaTeX preview when the cursor is inside an InlineMath or
 * DisplayMath node. The panel is anchored in editor scroll space so it
 * moves with the underlying expression instead of re-floating on scroll.
 */

import {
  type EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { CSS } from "../constants";
import { mathMacrosField } from "../state/math-macros";
import { resolveClickToSourcePos } from "./math-interactions";
import { findActiveMath } from "./math-source";
import { renderKatex } from "./math-widget";
import {
  createPreviewSurfaceContent,
  createPreviewSurfaceShell,
} from "../preview-surface";
import { documentAnalysisField } from "../state/document-analysis";

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
  position: PreviewPosition | null;
  maxWidth: number;
  width: number | null;
}

interface PreviewPosition {
  left: number;
  top: number;
}

function rectToAnchorRect(rect: {
  x?: number;
  y?: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}): AnchorRect {
  return {
    x: rect.x ?? rect.left,
    y: rect.y ?? rect.top,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function isVisibleRect(rect: { width: number; height: number }): boolean {
  return rect.width > 0 || rect.height > 0;
}

class MathPreviewPlugin implements PluginValue {
  private panel: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private dragListenerController: AbortController | null = null;
  private lastRaw = "";
  private lastRegion: MathRegionSnapshot | null = null;
  private lastRegionKey = "";
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private manualPosition: { left: number; top: number } | null = null;
  private anchorFromPos = -1;
  private anchorToPos = -1;
  private positionRequestId = 0;

  constructor(private view: EditorView) {
    this.scheduleCheck();
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.heightChanged ||
      update.state.field(documentAnalysisField).mathRegions !==
        update.startState.field(documentAnalysisField).mathRegions
    ) {
      this.scheduleCheck({
        forceReposition: update.heightChanged,
        resetManualPosition: true,
      });
    }
  }

  destroy(): void {
    this.removePanel();
  }

  private scheduleCheck(
    options: { forceReposition?: boolean; resetManualPosition?: boolean } = {},
  ): void {
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
    const regionKey = `${info.from}:${info.to}:${info.isDisplay ? "display" : "inline"}`;
    const regionChanged = regionKey !== this.lastRegionKey;
    const rawChanged = raw !== this.lastRaw;

    if (!this.panel) {
      this.createPanel();
    }

    if (options.resetManualPosition && (regionChanged || rawChanged)) {
      this.manualPosition = null;
    }

    if (rawChanged || regionChanged) {
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
    this.lastRegionKey = regionKey;
    if (options.forceReposition || regionChanged || rawChanged || !this.panel?.style.left) {
      this.requestPositionUpdate();
    }
  }

  private createPanel(): void {
    const panel = createPreviewSurfaceShell(CSS.mathPreview);
    const layer = document.createElement("div");
    layer.className = CSS.mathPreviewLayer;
    const dragListenerController = new AbortController();
    const listenerOptions = { signal: dragListenerController.signal };

    // Panel itself is draggable
    panel.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      const rect = panel.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    }, listenerOptions);

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging || !this.panel) return;
      const position = this.readDocumentPointerPosition(e.clientX, e.clientY);
      if (!position) return;
      const left = position.left - this.dragOffsetX;
      const top = position.top - this.dragOffsetY;
      this.manualPosition = { left, top };
      this.panel.style.left = `${left}px`;
      this.panel.style.top = `${top}px`;
    };

    const onMouseUp = () => {
      this.isDragging = false;
    };

    document.addEventListener("mousemove", onMouseMove, listenerOptions);
    document.addEventListener("mouseup", onMouseUp, listenerOptions);

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
    }, listenerOptions);
    panel.appendChild(content);

    this.contentEl = content;
    this.panel = panel;
    this.layer = layer;
    this.lastRaw = "";
    this.dragListenerController = dragListenerController;

    this.view.scrollDOM.classList.add(CSS.mathPreviewScroller);
    this.view.scrollDOM.appendChild(layer);
    layer.appendChild(panel);
  }

  private readAnchorRangeRect(): AnchorRect | null {
    if (this.anchorFromPos < 0 || this.anchorToPos < 0) return null;

    try {
      const { node: startNode, offset: startOffset } = this.view.domAtPos(this.anchorFromPos);
      const { node: endNode, offset: endOffset } = this.view.domAtPos(this.anchorToPos);
      const range = this.view.dom.ownerDocument.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      const rects = Array.from(range.getClientRects());
      if (rects.length > 0) {
        let left = rects[0].left;
        let top = rects[0].top;
        let right = rects[0].right;
        let bottom = rects[0].bottom;

        for (const rect of rects.slice(1)) {
          left = Math.min(left, rect.left);
          top = Math.min(top, rect.top);
          right = Math.max(right, rect.right);
          bottom = Math.max(bottom, rect.bottom);
        }

        return rectToAnchorRect({
          width: Math.max(right - left, 0),
          height: Math.max(bottom - top, 0),
          top,
          right,
          bottom,
          left,
        });
      }

      const rect = range.getBoundingClientRect();
      return isVisibleRect(rect) ? rectToAnchorRect(rect) : null;
    } catch {
      return null;
    }
  }

  private readAnchorRect(): AnchorRect | null {
    const rangeRect = this.readAnchorRangeRect();
    if (rangeRect) return rangeRect;

    try {
      // Fallback to source boundary coordinates when DOM range measurement is
      // unavailable (for example in lightweight test environments).
      const fromCoords = this.view.coordsAtPos(this.anchorFromPos, 1);
      const toCoords = this.view.coordsAtPos(this.anchorToPos, -1);
      if (!fromCoords || !toCoords) return null;

      return rectToAnchorRect({
        width: Math.max(toCoords.right - fromCoords.left, 0),
        height: Math.max(toCoords.bottom - fromCoords.top, 0),
        top: fromCoords.top,
        right: toCoords.right,
        bottom: toCoords.bottom,
        left: fromCoords.left,
      });
    } catch {
      return null;
    }
  }

  private readDocumentPointerPosition(clientX: number, clientY: number): PreviewPosition | null {
    const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
    if (!Number.isFinite(scrollerRect.left) || !Number.isFinite(scrollerRect.top)) {
      return null;
    }

    return {
      left: clientX - scrollerRect.left + this.view.scrollDOM.scrollLeft,
      top: clientY - scrollerRect.top + this.view.scrollDOM.scrollTop,
    };
  }

  private readAnchorPosition(): PreviewPosition | null {
    const rect = this.readAnchorRect();
    if (!rect) return null;

    const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
    return {
      left: rect.left - scrollerRect.left + this.view.scrollDOM.scrollLeft,
      top: rect.bottom - scrollerRect.top + this.view.scrollDOM.scrollTop + 4,
    };
  }

  private applyPosition(position: PreviewPosition): void {
    if (!this.panel || this.isDragging || this.manualPosition) return;
    this.panel.style.left = `${position.left}px`;
    this.panel.style.top = `${position.top}px`;
  }

  private readMaxPanelWidth(): number {
    const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
    const viewportWidth = Number.isFinite(scrollerRect.width)
      ? scrollerRect.width
      : window.innerWidth;
    return Math.max(0, Math.min(window.innerWidth, viewportWidth) - 10);
  }

  private readPanelWidth(maxWidth: number): number | null {
    if (!this.contentEl) return null;
    const contentWidth = this.contentEl.scrollWidth;
    if (!Number.isFinite(contentWidth) || contentWidth <= 0) return null;

    const borderWidth = this.panel
      ? (() => {
        const panelStyle = getComputedStyle(this.panel);
        const leftBorder = parseFloat(panelStyle.borderLeftWidth);
        const rightBorder = parseFloat(panelStyle.borderRightWidth);
        return (Number.isFinite(leftBorder) ? leftBorder : 0)
          + (Number.isFinite(rightBorder) ? rightBorder : 0);
      })()
      : 0;
    return Math.min(Math.ceil(contentWidth + borderWidth), maxWidth);
  }

  private applyWidth(maxWidth: number, width: number | null): void {
    if (!this.panel) return;
    this.panel.style.maxWidth = `${maxWidth}px`;
    if (width === null) {
      this.panel.style.width = "";
      return;
    }
    this.panel.style.width = `${width}px`;
  }

  private requestPositionUpdate(): void {
    if (!this.panel) return;
    const requestId = ++this.positionRequestId;
    this.view.requestMeasure({
      key: "cf-math-preview-pos",
      read: () => {
        if (requestId !== this.positionRequestId) return null;
        const maxWidth = this.readMaxPanelWidth();
        const position = this.readAnchorPosition();
        const width = this.readPanelWidth(maxWidth);
        if (!position) {
          return {
            requestId,
            position: null,
            maxWidth,
            width,
          } satisfies PositionMeasurement;
        }

        return {
          requestId,
          position,
          maxWidth,
          width,
        } satisfies PositionMeasurement;
      },
      write: (measurement) => {
        if (!measurement || !this.panel) return;
        if (measurement.requestId !== this.positionRequestId) return;

        this.applyWidth(measurement.maxWidth, measurement.width);
        if (measurement.position) {
          this.applyPosition(measurement.position);
        }
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
    this.dragListenerController?.abort();
    this.dragListenerController = null;
    this.layer?.remove();
    this.layer = null;
    this.view.scrollDOM.classList.remove(CSS.mathPreviewScroller);
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
    this.contentEl = null;
    this.lastRaw = "";
    this.lastRegion = null;
    this.lastRegionKey = "";
    this.manualPosition = null;
    this.anchorFromPos = -1;
    this.anchorToPos = -1;
  }
}

/** CM6 extension that shows a floating KaTeX preview when editing math. */
export const mathPreviewPlugin: Extension = ViewPlugin.fromClass(
  MathPreviewPlugin,
);
