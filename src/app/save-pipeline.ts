/**
 * Revisioned save pipeline for file-backed documents.
 *
 * Coordinates saves so that:
 * - Each document edit bumps a monotonic revision.
 * - Older queued saves cannot overwrite newer in-memory content.
 * - Repeated writes while a save is in flight are coalesced into one.
 * - A saved-content hash lets the file watcher suppress self-originated events.
 * - `clear()` / `initPath()` invalidate in-flight saves via a generation counter.
 */

/** FNV-1a hash — returns an 8-char hex string. */
export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class SaveWriteConflictError extends Error {
  constructor(path: string) {
    super(`File changed before save: ${path}`);
    this.name = "SaveWriteConflictError";
  }
}

export interface SaveSnapshot {
  content: string;
  expectedBaselineHash?: string;
}

/** The write function called by the pipeline. */
export type WriteFn = (
  path: string,
  snapshot: SaveSnapshot,
) => Promise<string>;

export interface SaveResult {
  saved: boolean;
  lastSavedRevision: number;
  savedContent?: string;
}

export class SavePipeline {
  private readonly writeFn: WriteFn;

  /** Monotonic revision counter per path (bumped on every doc change). */
  private readonly revisions = new Map<string, number>();

  /** Last revision that was successfully persisted to disk. */
  private readonly savedRevisions = new Map<string, number>();

  /** FNV-1a hash of the content most recently written to disk. */
  private readonly savedHashes = new Map<string, string>();

  /** Timestamp of the most recent successful save per path. */
  private readonly savedTimestamps = new Map<string, number>();

  /** Generation counter: bumped by clear() / initPath() to invalidate in-flight saves. */
  private readonly generations = new Map<string, number>();

  /** Whether a save loop is currently running for a path. */
  private readonly saving = new Map<string, boolean>();

  /**
   * While a save is in flight, a new save request replaces the pending
   * snapshot so only the latest content is written on the next iteration.
   */
  private readonly pending = new Map<string, (() => SaveSnapshot) | null>();

  constructor(writeFn: WriteFn) {
    this.writeFn = writeFn;
  }

  // ---------------------------------------------------------------------------
  // Revision tracking
  // ---------------------------------------------------------------------------

  bumpRevision(path: string): number {
    const next = (this.revisions.get(path) ?? 0) + 1;
    this.revisions.set(path, next);
    return next;
  }

  getRevision(path: string): number {
    return this.revisions.get(path) ?? 0;
  }

  getLastSavedRevision(path: string): number {
    return this.savedRevisions.get(path) ?? 0;
  }

  getLastSavedHash(path: string): string | undefined {
    return this.savedHashes.get(path);
  }

  // ---------------------------------------------------------------------------
  // Self-change suppression
  // ---------------------------------------------------------------------------

  /**
   * Returns true if the content on disk matches what the pipeline last wrote
   * and the write happened within the suppression window.
   */
  isSelfChange(path: string, diskContent: string, windowMs = 2000): boolean {
    const savedHash = this.savedHashes.get(path);
    if (savedHash === undefined) return false;

    const savedTs = this.savedTimestamps.get(path);
    if (savedTs === undefined) return false;
    if (Date.now() - savedTs >= windowMs) return false;

    return fnv1aHash(diskContent) === savedHash;
  }

  // ---------------------------------------------------------------------------
  // Path lifecycle
  // ---------------------------------------------------------------------------

  /** Initialise pipeline state for a freshly opened / reloaded file. */
  initPath(path: string, content: string): void {
    this.revisions.set(path, 0);
    this.savedRevisions.set(path, 0);
    this.savedHashes.set(path, fnv1aHash(content));
    this.generations.set(path, (this.generations.get(path) ?? 0) + 1);
  }

  /** Discard all pipeline state for a path (file closed / switched away). */
  clear(path: string): void {
    this.revisions.delete(path);
    this.savedRevisions.delete(path);
    this.savedHashes.delete(path);
    this.savedTimestamps.delete(path);
    this.generations.set(path, (this.generations.get(path) ?? 0) + 1);
    this.pending.delete(path);
  }

  // ---------------------------------------------------------------------------
  // Save coordination
  // ---------------------------------------------------------------------------

  isSaving(path: string): boolean {
    return this.saving.get(path) === true;
  }

  /**
   * Request a save for `path`. The `getSnapshot` callback is called lazily
   * so the pipeline always writes the freshest content.
   *
   * If a save is already in flight for this path, the new snapshot replaces
   * any previously pending one (coalescing). The save loop will pick it up
   * after the current write completes.
   */
  async save(
    path: string,
    getSnapshot: () => SaveSnapshot,
  ): Promise<SaveResult> {
    if (this.saving.get(path)) {
      // A save loop is already running — replace the pending snapshot.
      this.pending.set(path, getSnapshot);
      // Return a deferred result — the loop will handle it.
      return { saved: false, lastSavedRevision: this.getLastSavedRevision(path) };
    }

    return this.runSaveLoop(path, getSnapshot);
  }

  private async runSaveLoop(
    path: string,
    getSnapshot: () => SaveSnapshot,
  ): Promise<SaveResult> {
    this.saving.set(path, true);
    const startGeneration = this.generations.get(path) ?? 0;

    const isInvalidated = (): boolean =>
      (this.generations.get(path) ?? 0) !== startGeneration;

    let lastResult: SaveResult = {
      saved: false,
      lastSavedRevision: this.getLastSavedRevision(path),
    };

    try {
      let currentGetSnapshot: (() => SaveSnapshot) | null = getSnapshot;

      while (currentGetSnapshot) {
        this.pending.delete(path);
        const revisionAtStart = this.getRevision(path);
        const snapshot = currentGetSnapshot();

        try {
          const diskContent = await this.writeFn(path, snapshot);

          if (isInvalidated()) break;

          this.savedRevisions.set(path, revisionAtStart);
          this.savedHashes.set(path, fnv1aHash(diskContent));
          this.savedTimestamps.set(path, Date.now());

          lastResult = {
            saved: true,
            lastSavedRevision: revisionAtStart,
            savedContent: diskContent,
          };
        } catch (e: unknown) {
          if (!(e instanceof SaveWriteConflictError)) {
            console.error("[save-pipeline] write failed:", path, e);
          }
          lastResult = { saved: false, lastSavedRevision: this.getLastSavedRevision(path) };
          break;
        }

        if (isInvalidated()) break;

        // Check if a new snapshot was queued while we were writing.
        currentGetSnapshot = this.pending.get(path) ?? null;

        // If revision hasn't advanced, no need to re-save.
        if (currentGetSnapshot && this.getRevision(path) <= revisionAtStart) {
          currentGetSnapshot = null;
        }
      }
    } finally {
      this.saving.set(path, false);
    }

    if (isInvalidated()) {
      return { saved: false, lastSavedRevision: this.getLastSavedRevision(path) };
    }

    return lastResult;
  }
}
