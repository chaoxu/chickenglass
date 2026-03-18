/**
 * Auto-save manager.
 *
 * Triggers a save callback on a configurable interval, on window blur,
 * and on document visibility change (e.g. tab switch). Does not save
 * when the file is clean. Timer resets when a manual save occurs.
 */

/** Options for configuring the AutoSave instance. */
export interface AutoSaveOptions {
  /** Whether auto-save is enabled. */
  enabled: boolean;
  /** Interval between auto-saves in seconds. */
  intervalSeconds: number;
  /** Returns true when the active file has unsaved changes. */
  isDirty: () => boolean;
  /** Called to perform the save. */
  onSave: () => Promise<void>;
}

/**
 * Manages periodic and event-driven auto-save.
 *
 * Usage:
 * ```ts
 * const autoSave = new AutoSave({ enabled, intervalSeconds, isDirty, onSave });
 * // When manual save happens:
 * autoSave.notifyManualSave();
 * // On settings change:
 * autoSave.configure({ enabled, intervalSeconds });
 * // On teardown:
 * autoSave.destroy();
 * ```
 */
export class AutoSave {
  private options: AutoSaveOptions;
  private timerId: ReturnType<typeof setInterval> | null = null;
  /** Guards against overlapping concurrent saves (e.g. blur + visibilitychange firing together). */
  private saving = false;
  private readonly handleVisibilityChange: () => void;
  private readonly handleWindowBlur: () => void;

  constructor(options: AutoSaveOptions) {
    this.options = { ...options };

    this.handleVisibilityChange = () => {
      if (document.hidden) this.saveIfDirty();
    };

    this.handleWindowBlur = () => {
      this.saveIfDirty();
    };

    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("blur", this.handleWindowBlur);

    this.startTimer();
  }

  /**
   * Update auto-save configuration.
   * Restarts the timer if enabled/interval changes.
   */
  configure(patch: Partial<Pick<AutoSaveOptions, "enabled" | "intervalSeconds">>): void {
    const changed =
      ("enabled" in patch && patch.enabled !== this.options.enabled) ||
      ("intervalSeconds" in patch && patch.intervalSeconds !== this.options.intervalSeconds);

    this.options = { ...this.options, ...patch };

    if (changed) {
      this.stopTimer();
      this.startTimer();
    }
  }

  /**
   * Notify the auto-save manager that a manual save just occurred.
   * Resets the interval timer so we don't double-save immediately after.
   */
  notifyManualSave(): void {
    this.stopTimer();
    this.startTimer();
  }

  /** Release all resources and event listeners. */
  destroy(): void {
    this.stopTimer();
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("blur", this.handleWindowBlur);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private startTimer(): void {
    if (!this.options.enabled) return;
    const ms = this.options.intervalSeconds * 1000;
    this.timerId = setInterval(() => {
      this.saveIfDirty();
    }, ms);
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private saveIfDirty(): void {
    if (!this.options.enabled) return;
    if (this.saving) return;
    if (!this.options.isDirty()) return;
    this.saving = true;
    this.options.onSave().catch(() => {
      // Silently swallow errors — auto-save is best-effort
    }).finally(() => {
      this.saving = false;
    });
  }
}
