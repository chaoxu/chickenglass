/**
 * useAutoSave — React hook for periodic and event-driven auto-save.
 *
 * Saves whenever:
 *  - the interval fires (if isDirty)
 *  - the window loses focus (blur)
 *  - the document becomes hidden (tab switch / minimize)
 *
 * The timer resets whenever a save fires so we never double-save immediately
 * after an event-driven save.
 *
 * Implementation note: rather than using refs synced via separate useEffects,
 * the effect re-registers event listeners and the timer whenever isDirty or
 * onSave change. The savingRef guard (outside the effect) prevents concurrent
 * overlapping saves across re-registrations.
 */

import { useEffect, useRef } from "react";
import { isTauri } from "../../lib/tauri";

const TAURI_EVENT_SAVE_DELAY_MS = 250;

/**
 * @param isDirty  - True when there are unsaved changes to persist.
 * @param onSave   - Async callback that performs the actual save.
 * @param interval - Milliseconds between auto-save attempts. Defaults to 30 000 (30 s).
 *                   Pass 0 or a negative number to disable the timer entirely.
 */
export function useAutoSave(
  isDirty: boolean,
  onSave: () => Promise<void>,
  interval = 30_000,
  suspended = false,
  suspendedRef?: { current: boolean },
  suspendedVersionRef?: { current: number },
): void {
  // savingRef lives outside the effect so the guard persists across
  // re-registrations that happen when isDirty or onSave change.
  const savingRef = useRef(false);
  const pendingEventSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isSuspended = () => suspended || suspendedRef?.current === true;

    const clearPendingEventSave = () => {
      if (pendingEventSaveRef.current !== null) {
        clearTimeout(pendingEventSaveRef.current);
        pendingEventSaveRef.current = null;
      }
    };

    if (isSuspended()) {
      clearPendingEventSave();
      return clearPendingEventSave;
    }

    /** Save if dirty; guard against concurrent overlapping saves. */
    const trySave = () => {
      clearPendingEventSave();
      if (isSuspended()) return;
      if (!isDirty || savingRef.current) return;
      savingRef.current = true;
      onSave().catch(() => {
        // Auto-save is best-effort — swallow errors silently.
      }).finally(() => {
        savingRef.current = false;
      });
    };

    const scheduleEventSave = (reason: "blur" | "hidden") => {
      if (!isTauri()) {
        trySave();
        return;
      }

      clearPendingEventSave();
      const suspendedVersionAtSchedule = suspendedVersionRef?.current ?? 0;
      pendingEventSaveRef.current = setTimeout(() => {
        pendingEventSaveRef.current = null;
        if ((suspendedVersionRef?.current ?? 0) !== suspendedVersionAtSchedule) return;
        if (isSuspended()) return;
        if (reason === "blur" && document.hasFocus()) return;
        if (reason === "hidden" && !document.hidden) return;
        trySave();
      }, TAURI_EVENT_SAVE_DELAY_MS);
    };

    const handleBlur = () => scheduleEventSave("blur");
    const handleFocus = () => clearPendingEventSave();
    const handleVisibility = () => {
      if (document.hidden) {
        scheduleEventSave("hidden");
        return;
      }

      clearPendingEventSave();
    };

    const listeners: readonly [EventTarget, string, EventListener][] = [
      [window, "blur", handleBlur],
      [window, "focus", handleFocus],
      [document, "visibilitychange", handleVisibility],
    ];
    for (const [target, event, handler] of listeners) {
      target.addEventListener(event, handler);
    }

    // Periodic timer. Disabled when interval <= 0.
    let timerId: ReturnType<typeof setInterval> | null = null;
    if (interval > 0) {
      timerId = setInterval(trySave, interval);
    }

    return () => {
      for (const [target, event, handler] of listeners) {
        target.removeEventListener(event, handler);
      }
      clearPendingEventSave();
      if (timerId !== null) clearInterval(timerId);
    };
  }, [interval, isDirty, onSave, suspended, suspendedRef, suspendedVersionRef]);
}
