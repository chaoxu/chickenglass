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
 */

import { useEffect, useRef } from "react";

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
): void {
  // Stable refs so event handlers never close over stale values.
  const isDirtyRef = useRef(isDirty);
  const onSaveRef = useRef(onSave);
  const savingRef = useRef(false);

  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  useEffect(() => {
    /** Save if dirty; guard against concurrent overlapping saves. */
    const trySave = () => {
      if (!isDirtyRef.current || savingRef.current) return;
      savingRef.current = true;
      onSaveRef.current().catch(() => {
        // Auto-save is best-effort — swallow errors silently.
      }).finally(() => {
        savingRef.current = false;
      });
    };

    const handleBlur = () => trySave();
    const handleVisibility = () => { if (document.hidden) trySave(); };

    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);

    // Periodic timer.  Disabled when interval <= 0.
    let timerId: ReturnType<typeof setInterval> | null = null;
    if (interval > 0) {
      timerId = setInterval(trySave, interval);
    }

    return () => {
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (timerId !== null) clearInterval(timerId);
    };
  }, [interval]); // interval is the only stable dependency — refs handle the rest
}
