import type { DebugDocumentState } from "../app/hooks/use-app-debug";
import type {
  DebugRenderState,
  SelectionInfo,
} from "../editor/debug-helpers";
import type { StructureEditTarget } from "../state/cm-structure-edit";

const DEBUG_SESSION_STORAGE_KEY = "coflat-debug-session-id";
const DEBUG_SESSION_EVENTS_STORAGE_KEY = "coflat-debug-session-events";
const DEBUG_RECORDER_ENDPOINT = "/__coflat/debug-event";
const FLUSH_DELAY_MS = 400;
const MAX_BATCH_SIZE = 100;
const MAX_LOCAL_EVENTS = 500;
const MAX_TEXT_PREVIEW_CHARS = 120;

export interface DebugSessionEvent {
  readonly timestamp: number;
  readonly type: string;
  readonly summary: string;
  readonly detail?: unknown;
  readonly context?: DebugSessionContext;
}

export type DebugSessionKind = "human" | "webdriver";

export interface DebugSessionContext {
  readonly document: DebugDocumentState | null;
  readonly mode: string | null;
  readonly selection: SelectionInfo | null;
  readonly render: DebugRenderState | null;
  readonly structure: StructureEditTarget | null;
  readonly location: string;
}

export interface DebugSessionRecorderStatus {
  readonly sessionId: string | null;
  readonly sessionKind: DebugSessionKind;
  readonly connected: boolean;
  readonly queued: number;
  readonly localEventCount: number;
  readonly captureMode: "smart";
}

export interface DebugSessionCapture extends DebugSessionContext {
  readonly label: string | null;
  readonly recorder: DebugSessionRecorderStatus;
}

type DebugContextShape = DebugSessionContext;
type DebugContextCaptureMode = "none" | "compact" | "full";

interface PendingEvent extends DebugSessionEvent {
  readonly sessionId: string;
  readonly seq: number;
}

export interface DebugSessionExport {
  readonly currentDocument: string | null;
  readonly events: readonly DebugSessionEvent[];
  readonly status: DebugSessionRecorderStatus;
}

let sessionId: string | null = null;
let nextSequence = 0;
let flushTimer: number | null = null;
let flushInFlight = false;
let connected = false;
let lifecycleHooksInstalled = false;
const pendingEvents: PendingEvent[] = [];

function summarizeText(text: string, limit = MAX_TEXT_PREVIEW_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function contextCaptureModeForEvent(type: string): DebugContextCaptureMode {
  switch (type) {
    case "key":
    case "pointer":
    case "focus":
    case "structure":
    case "motion-guard":
    case "snapshot":
      return "full";
    case "scroll":
      return "none";
    default:
      return "compact";
  }
}

function buildCurrentContext(options: {
  readonly includeSelection: boolean;
  readonly includeRender: boolean;
}): DebugContextShape {
  if (!isBrowser()) {
    return {
      document: null,
      mode: null,
      selection: null,
      render: null,
      structure: null,
      location: "",
    };
  }
  return {
    document: window.__app?.getCurrentDocument?.() ?? null,
    mode: window.__app?.getMode?.() ?? null,
    selection: options.includeSelection ? (window.__cmDebug?.selection?.() ?? null) : null,
    render: options.includeRender ? (window.__cmDebug?.renderState?.() ?? null) : null,
    structure: window.__cmDebug?.structure?.() ?? null,
    location: window.location.href,
  };
}

function compactDebugContextForEvent(
  type: string,
  context: DebugSessionEvent["context"],
): DebugSessionEvent["context"] {
  if (!context) return undefined;
  const mode = contextCaptureModeForEvent(type);
  if (mode === "full") return context;
  if (mode === "none") {
    return {
      document: context.document,
      mode: context.mode,
      selection: null,
      render: null,
      structure: context.structure,
      location: context.location,
    };
  }
  return {
    document: context.document,
    mode: context.mode,
    selection: context.selection,
    render: null,
    structure: context.structure,
    location: context.location,
  };
}

function contextFromCaptureState(
  capture: DebugSessionCapture,
): DebugSessionContext {
  return {
    document: capture.document,
    mode: capture.mode,
    selection: capture.selection,
    render: capture.render,
    structure: capture.structure,
    location: capture.location,
  };
}

function sanitizeDocDetail(detail: unknown): unknown {
  if (!detail || typeof detail !== "object") return detail;
  const record = detail as {
    readonly changes?: ReadonlyArray<Record<string, unknown>>;
  } & Record<string, unknown>;
  if (!Array.isArray(record.changes)) return detail;
  return {
    ...record,
    changes: record.changes.map((change) => {
      const inserted = typeof change.inserted === "string" ? change.inserted : "";
      const nextChange = { ...change } as Record<string, unknown>;
      delete nextChange.inserted;
      nextChange.insertedLength = inserted.length;
      nextChange.insertedPreview = summarizeText(inserted);
      return nextChange;
    }),
  };
}

function sanitizeAppDetail(detail: unknown): unknown {
  if (!detail || typeof detail !== "object") return detail;
  const record = { ...(detail as Record<string, unknown>) };
  if (typeof record.content === "string") {
    const content = record.content;
    delete record.content;
    record.contentLength = content.length;
    record.contentPreview = summarizeText(content);
  }
  if (Array.isArray(record.files)) {
    record.files = record.files.map((file) => {
      if (!file || typeof file !== "object") return file;
      const nextFile = { ...(file as Record<string, unknown>) };
      if (typeof nextFile.content === "string") {
        const content = nextFile.content;
        delete nextFile.content;
        nextFile.contentLength = content.length;
      }
      if (typeof nextFile.base64 === "string") {
        const base64 = nextFile.base64;
        delete nextFile.base64;
        nextFile.base64Length = base64.length;
      }
      return nextFile;
    });
  }
  return record;
}

function sanitizeDebugEventDetail(type: string, detail: unknown): unknown {
  if (type === "doc") return sanitizeDocDetail(detail);
  if (type === "app") return sanitizeAppDetail(detail);
  return detail;
}

function contextForEvent(
  type: string,
  providedContext?: DebugSessionEvent["context"],
): DebugSessionEvent["context"] {
  if (providedContext) {
    return compactDebugContextForEvent(type, providedContext);
  }
  const mode = contextCaptureModeForEvent(type);
  if (mode === "full") {
    return buildCurrentContext({ includeSelection: true, includeRender: true });
  }
  if (mode === "compact") {
    return buildCurrentContext({ includeSelection: true, includeRender: false });
  }
  return buildCurrentContext({ includeSelection: false, includeRender: false });
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function parseLocalEvents(): PendingEvent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(DEBUG_SESSION_EVENTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((event): event is PendingEvent => (
          typeof event === "object"
          && event !== null
          && typeof (event as PendingEvent).sessionId === "string"
          && typeof (event as PendingEvent).seq === "number"
          && typeof (event as PendingEvent).timestamp === "number"
          && typeof (event as PendingEvent).type === "string"
          && typeof (event as PendingEvent).summary === "string"
        ))
      : [];
  } catch {
    return [];
  }
}

function persistLocalEvents(events: readonly PendingEvent[]): void {
  if (!isBrowser() || events.length === 0) return;
  const nextEvents = [...parseLocalEvents(), ...events].slice(-MAX_LOCAL_EVENTS);
  window.localStorage.setItem(DEBUG_SESSION_EVENTS_STORAGE_KEY, JSON.stringify(nextEvents));
}

function ensureSessionId(): string | null {
  if (!isBrowser()) return null;
  if (sessionId) return sessionId;
  const existing = window.sessionStorage.getItem(DEBUG_SESSION_STORAGE_KEY);
  if (existing) {
    sessionId = existing;
    return sessionId;
  }
  const generated = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  window.sessionStorage.setItem(DEBUG_SESSION_STORAGE_KEY, generated);
  sessionId = generated;
  return sessionId;
}

function sessionKind(): DebugSessionKind {
  if (!isBrowser()) return "human";
  return navigator.webdriver ? "webdriver" : "human";
}

function ensureLifecycleHooks(): void {
  if (!isBrowser() || lifecycleHooksInstalled) return;
  lifecycleHooksInstalled = true;
  window.addEventListener("pagehide", () => {
    void flushDebugSessionEvents();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushDebugSessionEvents();
    }
  });
}

function scheduleFlush(): void {
  if (!isBrowser() || flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushDebugSessionEvents();
  }, FLUSH_DELAY_MS);
}

export function recordDebugSessionEvent(
  event: Omit<DebugSessionEvent, "context"> & { context?: DebugSessionEvent["context"] },
): void {
  const nextSessionId = ensureSessionId();
  if (!nextSessionId) return;
  ensureLifecycleHooks();

  const pendingEvent = {
    ...event,
    detail: sanitizeDebugEventDetail(event.type, event.detail),
    context: contextForEvent(event.type, event.context),
    sessionId: nextSessionId,
    seq: ++nextSequence,
  };

  pendingEvents.push(pendingEvent);

  if (pendingEvents.length >= MAX_BATCH_SIZE) {
    void flushDebugSessionEvents();
    return;
  }
  scheduleFlush();
}

function snapshotSummary(capture: DebugSessionCapture): string {
  const parts = ["snapshot"];
  if (capture.label) parts.push(capture.label);
  if (capture.document?.path) parts.push(capture.document.path);
  if (capture.mode) parts.push(capture.mode);
  return parts.join(" ");
}

export async function flushDebugSessionEvents(): Promise<void> {
  if (!isBrowser() || flushInFlight || pendingEvents.length === 0) return;
  flushInFlight = true;
  const batch = pendingEvents.splice(0, pendingEvents.length);
  persistLocalEvents(batch);
  try {
    const response = await fetch(DEBUG_RECORDER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: batch[0]?.sessionId ?? ensureSessionId(),
        sessionKind: sessionKind(),
        events: batch,
      }),
      keepalive: true,
    });
    connected = response.ok;
    if (!response.ok) {
      pendingEvents.unshift(...batch);
    }
  } catch {
    connected = false;
    pendingEvents.unshift(...batch);
  } finally {
    flushInFlight = false;
    if (pendingEvents.length > 0) {
      scheduleFlush();
    }
  }
}

export function getDebugSessionRecorderStatus(): DebugSessionRecorderStatus {
  return {
    sessionId: ensureSessionId(),
    sessionKind: sessionKind(),
    connected,
    queued: pendingEvents.length,
    localEventCount: parseLocalEvents().length,
    captureMode: "smart",
  };
}

export function exportDebugSessionEvents({
  currentDocument = null,
}: {
  readonly currentDocument?: string | null;
} = {}): DebugSessionExport {
  persistLocalEvents(pendingEvents);
  return {
    currentDocument,
    events: parseLocalEvents(),
    status: getDebugSessionRecorderStatus(),
  };
}

export function clearDebugSessionEvents(): void {
  if (!isBrowser()) return;
  pendingEvents.length = 0;
  window.localStorage.removeItem(DEBUG_SESSION_EVENTS_STORAGE_KEY);
}

export function captureDebugSessionState(
  label?: string | null,
): DebugSessionCapture {
  const capture: DebugSessionCapture = {
    ...buildCurrentContext({ includeSelection: true, includeRender: true }),
    label: label ?? null,
    recorder: getDebugSessionRecorderStatus(),
  };
  recordDebugSessionEvent({
    timestamp: Date.now(),
    type: "snapshot",
    summary: snapshotSummary(capture),
    detail: capture,
    context: contextFromCaptureState(capture),
  });
  return capture;
}

export {
  compactDebugContextForEvent as _compactDebugContextForEventForTest,
  sanitizeDebugEventDetail as _sanitizeDebugEventDetailForTest,
};
