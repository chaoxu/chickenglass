import { useCallback, useEffect, useRef } from "react";
import { isTauri } from "../../lib/tauri";
import type { ActiveDocumentSignal } from "../active-document-signal";
import { logCatchError } from "../lib/log-catch-error";

const TAURI_EVENT_SAVE_DELAY_MS = 250;

export type AutoSaveFlushReason =
  | "blur"
  | "hidden"
  | "idle"
  | "navigation"
  | "pagehide"
  | "shutdown";

export interface UseAutoSaveOptions {
  activeDocumentSignal?: ActiveDocumentSignal;
  currentPath?: string | null;
}

export interface AutoSaveFlushOptions {
  force?: boolean;
}

export interface UseAutoSaveReturn {
  flushPendingAutoSave: (
    reason: AutoSaveFlushReason,
    options?: AutoSaveFlushOptions,
  ) => Promise<void>;
}

export function useAutoSave(
  isDirty: boolean,
  onSave: () => Promise<void>,
  delayMs = 30_000,
  suspended = false,
  suspensionVersion = 0,
  options: UseAutoSaveOptions = {},
): UseAutoSaveReturn {
  const currentPath = options.currentPath ?? null;
  const stateRef = useRef({
    currentPath,
    delayMs,
    isDirty,
    onSave,
    suspended,
  });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const saveAgainAfterCurrentRef = useRef<AutoSaveFlushOptions | null>(null);
  const pendingEventSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  stateRef.current = {
    currentPath,
    delayMs,
    isDirty,
    onSave,
    suspended,
  };

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const clearPendingEventSave = useCallback(() => {
    if (pendingEventSaveRef.current !== null) {
      clearTimeout(pendingEventSaveRef.current);
      pendingEventSaveRef.current = null;
    }
  }, []);

  const flushPendingAutoSave = useCallback(async (
    _reason: AutoSaveFlushReason,
    flushOptions?: AutoSaveFlushOptions,
  ) => {
    clearDebounceTimer();
    clearPendingEventSave();
    const state = stateRef.current;
    if (
      state.suspended ||
      (state.delayMs <= 0 && flushOptions?.force !== true) ||
      (!state.isDirty && flushOptions?.force !== true)
    ) {
      return;
    }
    if (savePromiseRef.current) {
      saveAgainAfterCurrentRef.current =
        flushOptions?.force === true ? { force: true } : {};
      return savePromiseRef.current;
    }

    const savePromise = (async () => {
      let nextFlushOptions: AutoSaveFlushOptions | null = flushOptions ?? {};
      while (nextFlushOptions !== null) {
        const activeState = stateRef.current;
        if (
          activeState.suspended ||
          (activeState.delayMs <= 0 && nextFlushOptions.force !== true) ||
          (!activeState.isDirty && nextFlushOptions.force !== true)
        ) {
          break;
        }
        saveAgainAfterCurrentRef.current = null;
        try {
          await activeState.onSave();
        } catch (error: unknown) {
          logCatchError("[auto-save] save failed")(error);
        }
        nextFlushOptions = saveAgainAfterCurrentRef.current;
      }
    })().finally(() => {
      if (savePromiseRef.current === savePromise) {
        savePromiseRef.current = null;
      }
    });
    savePromiseRef.current = savePromise;
    return savePromise;
  }, [clearDebounceTimer, clearPendingEventSave]);

  const scheduleDebouncedSave = useCallback(() => {
    clearDebounceTimer();
    const state = stateRef.current;
    if (
      state.suspended ||
      !state.isDirty ||
      !state.currentPath ||
      state.delayMs <= 0
    ) {
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void flushPendingAutoSave("idle");
    }, state.delayMs);
  }, [clearDebounceTimer, flushPendingAutoSave]);

  useEffect(() => {
    if (suspended) {
      clearDebounceTimer();
      clearPendingEventSave();
      return;
    }
    scheduleDebouncedSave();
  }, [
    clearDebounceTimer,
    clearPendingEventSave,
    currentPath,
    delayMs,
    isDirty,
    scheduleDebouncedSave,
    suspended,
    suspensionVersion,
  ]);

  useEffect(() => {
    const signal = options.activeDocumentSignal;
    if (!signal) {
      return;
    }
    return signal.subscribe(() => {
      const snapshot = signal.getSnapshot();
      const currentPath = stateRef.current.currentPath;
      if (snapshot.path === currentPath) {
        scheduleDebouncedSave();
      }
    });
  }, [options.activeDocumentSignal, scheduleDebouncedSave]);

  useEffect(() => {
    const scheduleEventSave = (reason: "blur" | "hidden") => {
      if (!isTauri()) {
        void flushPendingAutoSave(reason);
        return;
      }

      clearPendingEventSave();
      pendingEventSaveRef.current = setTimeout(() => {
        pendingEventSaveRef.current = null;
        if (reason === "blur" && document.hasFocus()) return;
        if (reason === "hidden" && !document.hidden) return;
        void flushPendingAutoSave(reason);
      }, TAURI_EVENT_SAVE_DELAY_MS);
    };

    const handleBlur = () => scheduleEventSave("blur");
    const handleFocus = () => clearPendingEventSave();
    const handlePageHide = () => {
      void flushPendingAutoSave("pagehide");
    };
    const handleBeforeUnload = () => {
      void flushPendingAutoSave("shutdown");
    };
    const handleVisibility = () => {
      if (document.hidden) {
        scheduleEventSave("hidden");
      } else {
        clearPendingEventSave();
      }
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearPendingEventSave();
    };
  }, [clearPendingEventSave, flushPendingAutoSave]);

  useEffect(() => {
    return () => {
      clearDebounceTimer();
      clearPendingEventSave();
    };
  }, [clearDebounceTimer, clearPendingEventSave]);

  return { flushPendingAutoSave };
}
