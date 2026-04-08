import type { DebugDocumentState } from "../app/hooks/use-app-debug";

const DEBUG_SESSION_STORAGE_KEY = "coflat-debug-session-id";
const DEBUG_RECORDER_ENDPOINT = "/__coflat/debug-event";
const FLUSH_DELAY_MS = 400;
const MAX_BATCH_SIZE = 100;

export interface DebugSessionEvent {
  readonly timestamp: number;
  readonly type: string;
  readonly summary: string;
  readonly detail?: unknown;
  readonly context?: {
    readonly document: DebugDocumentState | null;
    readonly mode: string | null;
    readonly selection: unknown;
    readonly location: string;
  };
}

type DebugSessionKind = "human" | "webdriver";

interface PendingEvent extends DebugSessionEvent {
  readonly sessionId: string;
  readonly seq: number;
}

let sessionId: string | null = null;
let nextSequence = 0;
let flushTimer: number | null = null;
let flushInFlight = false;
let connected = false;
let lifecycleHooksInstalled = false;
const pendingEvents: PendingEvent[] = [];

function isBrowser(): boolean {
  return typeof window !== "undefined";
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

function currentContext(): DebugSessionEvent["context"] {
  if (!isBrowser()) {
    return {
      document: null,
      mode: null,
      selection: null,
      location: "",
    };
  }
  return {
    document: window.__app?.getCurrentDocument?.() ?? null,
    mode: window.__app?.getMode?.() ?? null,
    selection: window.__cmDebug?.selection?.() ?? null,
    location: window.location.href,
  };
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

  pendingEvents.push({
    ...event,
    context: event.context ?? currentContext(),
    sessionId: nextSessionId,
    seq: ++nextSequence,
  });

  if (pendingEvents.length >= MAX_BATCH_SIZE) {
    void flushDebugSessionEvents();
    return;
  }
  scheduleFlush();
}

export async function flushDebugSessionEvents(): Promise<void> {
  if (!isBrowser() || flushInFlight || pendingEvents.length === 0) return;
  flushInFlight = true;
  const batch = pendingEvents.splice(0, pendingEvents.length);
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

export function getDebugSessionRecorderStatus(): {
  readonly sessionId: string | null;
  readonly sessionKind: DebugSessionKind;
  readonly connected: boolean;
  readonly queued: number;
} {
  return {
    sessionId: ensureSessionId(),
    sessionKind: sessionKind(),
    connected,
    queued: pendingEvents.length,
  };
}
