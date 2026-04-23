export interface ActiveDocumentSnapshot {
  path: string | null;
  revision: number;
}

export interface ActiveDocumentSignal {
  getSnapshot: () => ActiveDocumentSnapshot;
  subscribe: (listener: () => void) => () => void;
  publish: (path: string | null) => void;
}

export type ActiveDocumentSignalScheduler = (notify: () => void) => () => void;

export interface ActiveDocumentSignalOptions {
  readonly scheduleNotify?: ActiveDocumentSignalScheduler;
}

export const EMPTY_ACTIVE_DOCUMENT_SNAPSHOT: ActiveDocumentSnapshot = {
  path: null,
  revision: 0,
};
export const unsubscribeNoop = () => {};

function scheduleActiveDocumentNotify(notify: () => void): () => void {
  const browserWindow = typeof window === "undefined" ? null : window;
  let cancelled = false;
  let raf = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    if (browserWindow && raf !== 0) {
      browserWindow.cancelAnimationFrame(raf);
      raf = 0;
    }
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    notify();
  };

  if (browserWindow && typeof browserWindow.requestAnimationFrame === "function") {
    raf = browserWindow.requestAnimationFrame(run);
    timeout = setTimeout(run, 50);
  } else {
    timeout = setTimeout(run, 0);
  }

  return () => {
    cancelled = true;
    if (browserWindow && raf !== 0) {
      browserWindow.cancelAnimationFrame(raf);
      raf = 0;
    }
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
}

export function createActiveDocumentSignal(
  options: ActiveDocumentSignalOptions = {},
): ActiveDocumentSignal {
  let snapshot = EMPTY_ACTIVE_DOCUMENT_SNAPSHOT;
  const listeners = new Set<() => void>();
  const scheduleNotify = options.scheduleNotify ?? scheduleActiveDocumentNotify;
  let cancelScheduledNotify: (() => void) | null = null;

  const flush = () => {
    cancelScheduledNotify = null;
    for (const listener of listeners) {
      listener();
    }
  };

  const scheduleFlush = () => {
    if (listeners.size === 0 || cancelScheduledNotify !== null) {
      return;
    }
    cancelScheduledNotify = scheduleNotify(flush);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && cancelScheduledNotify !== null) {
          cancelScheduledNotify();
          cancelScheduledNotify = null;
        }
      };
    },
    publish: (path) => {
      snapshot = {
        path,
        revision: snapshot.revision + 1,
      };
      scheduleFlush();
    },
  };
}
