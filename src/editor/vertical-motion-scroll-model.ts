export const FALLBACK_LINE_HEIGHT_PX = 24;
export const REVERSE_SCROLL_JITTER_PX = 8;
export const REVERSE_SCROLL_CORRECTION_ATTEMPTS = 6;
export const REVERSE_SCROLL_CORRECTION_DELAYS_MS = [0, 8, 16, 24, 30, 40, 48, 72, 96] as const;

const MAX_DIRECTIONAL_SCROLL_STEP_PX = 144;

export interface VerticalMotionSnapshot {
  readonly head: number;
  readonly line: number;
  readonly scrollTop: number;
}

export function sumTraversedLineHeights(
  fromLine: number,
  toLine: number,
  getLineHeight: (lineNumber: number) => number,
): number {
  if (fromLine === toLine) return 0;

  let total = 0;
  if (toLine < fromLine) {
    for (let line = toLine; line < fromLine; line += 1) {
      total += getLineHeight(line);
    }
    return total;
  }

  for (let line = fromLine; line < toLine; line += 1) {
    total += getLineHeight(line);
  }
  return total;
}

export function correctedReverseVerticalScrollTop(
  before: VerticalMotionSnapshot,
  after: VerticalMotionSnapshot,
  traversedHeight: number,
): number | null {
  const lineDelta = after.line - before.line;
  const headDelta = after.head - before.head;
  const scrollDelta = after.scrollTop - before.scrollTop;
  const movedUp = lineDelta < 0 || headDelta < 0;
  const movedDown = lineDelta > 0 || headDelta > 0;

  if (movedUp && scrollDelta > REVERSE_SCROLL_JITTER_PX) {
    return Math.max(0, before.scrollTop - traversedHeight);
  }
  if (movedDown && scrollDelta < -REVERSE_SCROLL_JITTER_PX) {
    return before.scrollTop + traversedHeight;
  }
  return null;
}

export function maxDirectionalScrollStep(viewportHeight: number): number {
  return Math.max(
    FALLBACK_LINE_HEIGHT_PX * 4,
    Math.min(MAX_DIRECTIONAL_SCROLL_STEP_PX, viewportHeight / 4),
  );
}

export function boundedDirectionalScrollTop(
  scrollTop: number,
  baselineScrollTop: number,
  direction: "up" | "down",
  viewportHeight: number,
): number {
  const maxStep = maxDirectionalScrollStep(viewportHeight);
  if (direction === "down") {
    return Math.max(
      baselineScrollTop,
      Math.min(scrollTop, baselineScrollTop + maxStep),
    );
  }
  return Math.min(
    baselineScrollTop,
    Math.max(scrollTop, baselineScrollTop - maxStep),
  );
}
