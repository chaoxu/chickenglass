/**
 * interaction-trace — Circular buffer for click and scroll-jump events.
 *
 * Consumed by InteractionTracePlugin (writes), the debug sidebar (reads),
 * and window.__cfDebug.interactionLog (reads).
 */

export interface InteractionTraceEntry {
  /** Unix timestamp (ms). */
  ts: number;
  type: "click" | "scroll-jump";
  /** Lexical node `__type` (e.g. "inline-math", "paragraph"). */
  nodeType: string | null;
  /** Lexical node key. */
  nodeKey: string | null;
  /** Short DOM selector summary of click target. */
  target: string;
  scrollBefore: number;
  scrollAfter: number;
  /** Whether a CLICK_COMMAND handler returned true. */
  handled: boolean;
}

const MAX_ENTRIES = 50;
const buffer: InteractionTraceEntry[] = [];

export function pushTraceEntry(entry: InteractionTraceEntry): void {
  if (buffer.length >= MAX_ENTRIES) {
    buffer.shift();
  }
  buffer.push(entry);
}

export function getInteractionLog(): readonly InteractionTraceEntry[] {
  return buffer;
}

export function clearInteractionLog(): void {
  buffer.length = 0;
}
