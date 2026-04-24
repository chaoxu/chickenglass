import type { ExternalDocumentConflict } from "../editor-session-model";
import { logCatchError } from "../lib/log-catch-error";
import { basename } from "../lib/utils";

interface ExternalConflictBannerProps {
  conflict: ExternalDocumentConflict | null;
  currentPath: string | null;
  keepExternalConflict: (path: string) => void | Promise<void>;
  mergeExternalConflict: (path: string) => void | Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  closeCurrentFile: (options?: { discard?: boolean }) => Promise<boolean>;
}

export function ExternalConflictBanner({
  conflict,
  currentPath,
  keepExternalConflict,
  mergeExternalConflict,
  reloadFile,
  closeCurrentFile,
}: ExternalConflictBannerProps) {
  if (!conflict || conflict.path !== currentPath) {
    return null;
  }

  const displayName = basename(conflict.path);
  const deleted = conflict.kind === "deleted";
  const message = deleted
    ? `"${displayName}" was deleted on disk while you have local edits.`
    : `"${displayName}" changed on disk while you have local edits.`;

  const keepLocalEdits = () => {
    void Promise.resolve(keepExternalConflict(conflict.path)).catch(
      logCatchError("[external-conflict] keep local edits failed", conflict.path),
    );
  };

  const discardLocalEdits = () => {
    const task = deleted
      ? closeCurrentFile({ discard: true }).then(() => undefined)
      : reloadFile(conflict.path);
    void task.catch(
      logCatchError("[external-conflict] discard local edits failed", conflict.path),
    );
  };

  const mergeChanges = () => {
    void Promise.resolve(mergeExternalConflict(conflict.path)).catch(
      logCatchError("[external-conflict] merge failed", conflict.path),
    );
  };

  return (
    <div
      className="flex min-h-11 shrink-0 items-center gap-3 border-b border-[var(--cf-border)] bg-[var(--cf-panel)] px-4 py-2 text-sm text-[var(--cf-text)]"
      role="status"
      aria-live="polite"
    >
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <button
        type="button"
        className="shrink-0 rounded border border-[var(--cf-border)] px-2.5 py-1 text-xs font-medium text-[var(--cf-text)] hover:bg-[var(--cf-hover)]"
        onClick={keepLocalEdits}
      >
        Keep edits
      </button>
      {!deleted ? (
        <button
          type="button"
          className="shrink-0 rounded border border-[var(--cf-border)] px-2.5 py-1 text-xs font-medium text-[var(--cf-text)] hover:bg-[var(--cf-hover)]"
          onClick={mergeChanges}
        >
          Merge
        </button>
      ) : null}
      <button
        type="button"
        className="shrink-0 rounded bg-[var(--cf-accent)] px-2.5 py-1 text-xs font-medium text-[var(--cf-accent-fg)] hover:opacity-90"
        onClick={discardLocalEdits}
      >
        {deleted ? "Close file" : "Reload from disk"}
      </button>
    </div>
  );
}
