/**
 * FPS meter — requestAnimationFrame-based frame counter.
 *
 * Zero-cost when disabled: no rAF loop runs until explicitly toggled on.
 * When enabled, counts frames each second and notifies subscribers.
 * Designed for `useSyncExternalStore` consumption in the status bar.
 */

// ── State ───────────────────────────────────────────────────────────────────

let enabled = false;
let rafId: number | null = null;
let frameCount = 0;
let lastTimestamp = 0;
let currentFps = 0;
let currentFrameTime = 0;

// ── Subscribers ─────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

// ── rAF loop ────────────────────────────────────────────────────────────────

function onFrame(timestamp: number): void {
  frameCount++;
  const elapsed = timestamp - lastTimestamp;
  if (elapsed >= 1000) {
    currentFps = Math.round((frameCount * 1000) / elapsed);
    currentFrameTime = Math.round(elapsed / frameCount * 10) / 10;
    frameCount = 0;
    lastTimestamp = timestamp;
    notify();
  }
  if (enabled) {
    rafId = requestAnimationFrame(onFrame);
  }
}

function start(): void {
  if (rafId !== null) return;
  enabled = true;
  frameCount = 0;
  lastTimestamp = performance.now();
  currentFps = 0;
  currentFrameTime = 0;
  notify();
  rafId = requestAnimationFrame(onFrame);
}

function stop(): void {
  enabled = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  currentFps = 0;
  currentFrameTime = 0;
  notify();
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface FpsMeterSnapshot {
  readonly enabled: boolean;
  readonly fps: number;
  readonly frameTime: number;
}

/** Toggle the FPS meter on/off. Returns the new enabled state. */
export function toggleFpsMeter(): boolean {
  if (enabled) {
    stop();
  } else {
    start();
  }
  return enabled;
}

/** Explicitly set the FPS meter to enabled or disabled. */
export function setFpsMeterEnabled(next: boolean): void {
  if (next === enabled) return;
  if (next) {
    start();
  } else {
    stop();
  }
}

/** Stop the FPS meter if running (for cleanup on unmount/HMR). */
export function stopFpsMeter(): void {
  if (enabled) stop();
}

// ── useSyncExternalStore-compatible API ─────────────────────────────────────

let cachedSnapshot: FpsMeterSnapshot = { enabled: false, fps: 0, frameTime: 0 };

export function subscribeFpsMeter(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getFpsMeterSnapshot(): FpsMeterSnapshot {
  if (
    cachedSnapshot.enabled !== enabled ||
    cachedSnapshot.fps !== currentFps ||
    cachedSnapshot.frameTime !== currentFrameTime
  ) {
    cachedSnapshot = { enabled, fps: currentFps, frameTime: currentFrameTime };
  }
  return cachedSnapshot;
}
