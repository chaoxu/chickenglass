import type { DebugDocumentState } from "../app/hooks/use-app-debug-types";
import { useDevSettings } from "../state/dev-settings";
import { getConnectedApp } from "./debug-bridge";

const DEBUG_SESSION_STORAGE_KEY = "coflat-debug-session-id";
const DEBUG_RECORDER_ENDPOINT = "/__coflat/debug-event";
const JSON_CONTENT_TYPE = "application/json";
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
    readonly selection: EditorSelectionSnapshot | null;
    readonly editor: EditorTextSnapshot | null;
    readonly activeElement: ElementSnapshot | null;
    readonly settings: SettingsSnapshot;
    readonly location: string;
  };
}

type DebugSessionKind = "human" | "webdriver";

interface PendingEvent extends DebugSessionEvent {
  readonly sessionId: string;
  readonly seq: number;
}

interface EditorSelectionSnapshot {
  readonly anchorOffset: number | null;
  readonly anchorText: string | null;
  readonly focusOffset: number | null;
  readonly focusText: string | null;
  readonly selectedText: string;
}

interface EditorTextSnapshot {
  readonly docLength: number;
  readonly docHash: string;
  readonly excerpt: {
    readonly from: number;
    readonly to: number;
    readonly text: string;
  };
}

interface ElementSnapshot {
  readonly tag: string;
  readonly className: string | null;
  readonly id: string | null;
  readonly role: string | null;
  readonly text: string | null;
}

interface SettingsSnapshot {
  readonly revealPresentation: string | null;
  readonly commandLogging: boolean;
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

function activeElementSnapshot(): ElementSnapshot | null {
  if (!isBrowser()) return null;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const text = active.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return {
    className: typeof active.className === "string" && active.className.length > 0
      ? active.className
      : null,
    id: active.id || null,
    role: active.getAttribute("role"),
    tag: active.tagName.toLowerCase(),
    text: text.length > 0 ? text.slice(0, 160) : null,
  };
}

function readSettingsSnapshot(): SettingsSnapshot {
  let revealPresentation: string | null = null;
  if (isBrowser()) {
    try {
      const raw = window.localStorage.getItem("cf-settings");
      const parsed = raw ? JSON.parse(raw) as { revealPresentation?: unknown } : null;
      revealPresentation = typeof parsed?.revealPresentation === "string"
        ? parsed.revealPresentation
        : null;
    } catch {
      revealPresentation = null;
    }
  }
  return {
    commandLogging: useDevSettings.getState().commandLogging,
    revealPresentation,
  };
}

function currentSelection(): EditorSelectionSnapshot | null {
  if (!isBrowser()) return null;
  const selection = window.getSelection();
  if (!selection) return null;
  return {
    anchorOffset: selection.anchorOffset,
    anchorText: selection.anchorNode?.textContent?.slice(0, 160) ?? null,
    focusOffset: selection.focusOffset,
    focusText: selection.focusNode?.textContent?.slice(0, 160) ?? null,
    selectedText: selection.toString().slice(0, 160),
  };
}

function currentContext(): DebugSessionEvent["context"] {
  if (!isBrowser()) {
    return {
      activeElement: null,
      document: null,
      editor: null,
      mode: null,
      selection: null,
      settings: {
        commandLogging: false,
        revealPresentation: null,
      },
      location: "",
    };
  }
  const app = getConnectedApp();
  const selection = currentSelection();
  return {
    activeElement: activeElementSnapshot(),
    document: app ? app.getCurrentDocument() : null,
    editor: null,
    mode: app ? app.getMode() : null,
    selection,
    settings: readSettingsSnapshot(),
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
  // The recorder endpoint is only mounted by the Vite dev middleware. In
  // preview/production builds there is no sink, so draining the queue over
  // the network just produces 404s and re-queues forever.
  if (!import.meta.env.DEV) {
    pendingEvents.length = 0;
    connected = false;
    return;
  }
  flushInFlight = true;
  const batch = pendingEvents.splice(0, pendingEvents.length);
  try {
    const response = await fetch(DEBUG_RECORDER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": JSON_CONTENT_TYPE,
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
