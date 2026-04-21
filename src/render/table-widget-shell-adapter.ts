import type { EditorView } from "@codemirror/view";
import { requestScrollStabilizedMeasure } from "./scroll-anchor";

export class TableWidgetShellAdapter {
  private resizeObserver: ResizeObserver | null = null;
  private resizeMeasureFrame: number | null = null;

  observeContainer(container: HTMLElement, view: EditorView): void {
    this.clearPendingResizeMeasure();
    this.resizeObserver?.disconnect();

    if (typeof ResizeObserver === "undefined") {
      this.resizeObserver = null;
      return;
    }

    let isFirstCallback = true;
    this.resizeObserver = new ResizeObserver(() => {
      if (isFirstCallback) {
        isFirstCallback = false;
        return;
      }
      if (this.resizeMeasureFrame !== null) return;
      this.resizeMeasureFrame = requestAnimationFrame(() => {
        this.resizeMeasureFrame = null;
        requestScrollStabilizedMeasure(view);
      });
    });
    this.resizeObserver.observe(container);
  }

  release(): void {
    this.clearPendingResizeMeasure();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private clearPendingResizeMeasure(): void {
    if (this.resizeMeasureFrame !== null) {
      cancelAnimationFrame(this.resizeMeasureFrame);
      this.resizeMeasureFrame = null;
    }
  }
}
