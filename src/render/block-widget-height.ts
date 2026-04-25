import type { EditorView } from "@codemirror/view";
import { requestScrollStabilizedMeasure } from "./scroll-anchor";

export interface BlockWidgetHeightBinding {
  resizeObserver: ResizeObserver | null;
  resizeMeasureFrame: number | null;
  reconnectObserver: MutationObserver | null;
  detachedMeasureWarned: boolean;
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
  binding.reconnectObserver?.disconnect();
  binding.reconnectObserver = null;
}

function scheduleMeasurement(
  binding: BlockWidgetHeightBinding,
  measure: FrameRequestCallback,
): void {
  if (binding.resizeMeasureFrame !== null) return;
  binding.resizeMeasureFrame = requestAnimationFrame(measure);
}

function observeReconnect(
  binding: BlockWidgetHeightBinding,
  container: HTMLElement,
  view: EditorView,
  measure: FrameRequestCallback,
): void {
  if (
    binding.reconnectObserver !== null
    || typeof MutationObserver === "undefined"
  ) {
    return;
  }

  const root = (view as Partial<EditorView>).dom?.ownerDocument?.documentElement
    ?? container.ownerDocument.documentElement;
  if (!root) return;
  binding.reconnectObserver = new MutationObserver(() => {
    if (!container.isConnected) return;
    binding.reconnectObserver?.disconnect();
    binding.reconnectObserver = null;
    scheduleMeasurement(binding, measure);
  });
  binding.reconnectObserver.observe(root, {
    childList: true,
    subtree: true,
  });
}

export function observeBlockWidgetHeight(
  binding: BlockWidgetHeightBinding,
  container: HTMLElement,
  view: EditorView,
  cache: Map<string, number>,
  key: string,
): void {
  clearBlockWidgetHeightBinding(binding);
  binding.detachedMeasureWarned = false;
  let detachedMeasureAttempts = 0;

  const measure = (): void => {
    if (!container.isConnected) {
      binding.resizeMeasureFrame = null;
      if (detachedMeasureAttempts >= MAX_DETACHED_MEASURE_ATTEMPTS) {
        const cachedHeight = estimatedBlockWidgetHeight(cache, key);
        if (cachedHeight < 0 && !binding.detachedMeasureWarned) {
          binding.detachedMeasureWarned = true;
          console.warn(
            "[coflats] block widget height measurement deferred until reconnect",
            {
              cachedHeight,
              key,
            },
          );
        }
        observeReconnect(binding, container, view, measure);
        return;
      }
      detachedMeasureAttempts += 1;
      scheduleMeasurement(binding, measure);
      return;
    }
    binding.reconnectObserver?.disconnect();
    binding.reconnectObserver = null;
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
    scheduleMeasurement(binding, measure);
    return;
  }

  binding.resizeObserver = new ResizeObserver(() => {
    scheduleMeasurement(binding, measure);
  });
  binding.resizeObserver.observe(container);
  scheduleMeasurement(binding, measure);
}
