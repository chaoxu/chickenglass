import { recordDebugSessionEvent } from "../debug/session-recorder";
import { type EditorView } from "@codemirror/view";

export interface DebugTimelineEvent {
  readonly timestamp: number;
  readonly type:
    | "key"
    | "doc"
    | "pointer"
    | "caret"
    | "range"
    | "scroll"
    | "focus"
    | "structure"
    | "motion-guard";
  readonly summary: string;
  readonly detail?: unknown;
}

const MAX_TIMELINE_EVENTS = 200;
const debugTimelineEvents = new WeakMap<EditorView, DebugTimelineEvent[]>();

export function appendDebugTimelineEvent(
  view: EditorView,
  event: DebugTimelineEvent,
): void {
  const current = debugTimelineEvents.get(view) ?? [];
  const next = [...current, event];
  if (next.length > MAX_TIMELINE_EVENTS) {
    next.splice(0, next.length - MAX_TIMELINE_EVENTS);
  }
  debugTimelineEvents.set(view, next);
  recordDebugSessionEvent(event);
}

export function getDebugTimelineEvents(
  view: EditorView,
): readonly DebugTimelineEvent[] {
  return debugTimelineEvents.get(view) ?? [];
}

export function clearDebugTimelineEvents(
  view: EditorView,
): void {
  debugTimelineEvents.delete(view);
}
