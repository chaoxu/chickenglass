/**
 * interaction-trace — Circular buffer for user interaction events.
 *
 * Consumed by InteractionTracePlugin (writes), the debug sidebar (reads),
 * and window.__cfDebug.interactionLog (reads).
 */

import type { InteractionTraceEntry } from "../lib/debug-types";

export type { InteractionTraceEntry } from "../lib/debug-types";

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
