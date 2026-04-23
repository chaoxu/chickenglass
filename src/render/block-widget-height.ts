import type { EditorView } from "@codemirror/view";
import { requestScrollStabilizedMeasure } from "./scroll-anchor";

export interface BlockWidgetHeightBinding {
  resizeObserver: ResizeObserver | null;
  resizeMeasureFrame: number | null;
}

const MAX_DETACHED_MEASURE_ATTEMPTS = 8;

export function estimatedBlockWidgetHeight(
  cache: ReadonlyMap<string, number>,
  key: string,
): number {
  return cache.get(key) ?? -1;
}

function normalizeMeasuredHeight(height: number): number | null {
  if (!Number.isFinite(height) || height <= 0) return null;
  return Math.round(height);
}

export function cacheBlockWidgetHeight(
  cache: Map<string, number>,
  key: string,
  height: number,
): boolean {
  const normalized = normalizeMeasuredHeight(height);
  if (normalized === null) return false;

  const previous = cache.get(key);
  if (previous !== undefined && Math.abs(previous - normalized) < 1) {
    return false;
  }

  cache.set(key, normalized);
  return true;
}

export function clearBlockWidgetHeightBinding(
  binding: BlockWidgetHeightBinding,
): void {
  if (binding.resizeMeasureFrame !== null) {
    cancelAnimationFrame(binding.resizeMeasureFrame);
    binding.resizeMeasureFrame = null;
  }
  binding.resizeObserver?.disconnect();
  binding.resizeObserver = null;
}

export function observeBlockWidgetHeight(
  binding: BlockWidgetHeightBinding,
  container: HTMLElement,
  view: EditorView,
  cache: Map<string, number>,
  key: string,
): void {
  clearBlockWidgetHeightBinding(binding);
  let detachedMeasureAttempts = 0;

  const measure = (): void => {
    if (!container.isConnected) {
      binding.resizeMeasureFrame = null;
      if (detachedMeasureAttempts >= MAX_DETACHED_MEASURE_ATTEMPTS) {
        return;
      }
      detachedMeasureAttempts += 1;
      binding.resizeMeasureFrame = requestAnimationFrame(measure);
      return;
    }
    detachedMeasureAttempts = 0;
    binding.resizeMeasureFrame = null;
    const changed = cacheBlockWidgetHeight(
      cache,
      key,
      container.getBoundingClientRect().height,
    );
    if (changed) {
      requestScrollStabilizedMeasure(view);
    }
  };

  if (typeof ResizeObserver === "undefined") {
    binding.resizeMeasureFrame = requestAnimationFrame(measure);
    return;
  }

  binding.resizeObserver = new ResizeObserver(() => {
    if (binding.resizeMeasureFrame !== null) return;
    binding.resizeMeasureFrame = requestAnimationFrame(measure);
  });
  binding.resizeObserver.observe(container);
  binding.resizeMeasureFrame = requestAnimationFrame(measure);
}
