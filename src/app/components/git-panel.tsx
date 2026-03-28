import { memo, useState, useCallback, useMemo } from "react";
import type { GitController } from "../hooks/use-git";
import type { GitStatusEntry } from "../tauri-client/git";
import { cn } from "../lib/utils";

interface GitPanelProps {
  git: GitController;
}

const STATUS_LABELS: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  typechange: "T",
  untracked: "?",
};

const STATUS_COLORS: Record<string, string> = {
  added: "text-green-600 dark:text-green-400",
  modified: "text-yellow-600 dark:text-yellow-400",
  deleted: "text-red-600 dark:text-red-400",
  renamed: "text-blue-600 dark:text-blue-400",
  typechange: "text-purple-600 dark:text-purple-400",
  untracked: "text-[var(--cf-muted)]",
};

function fileBasename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function fileDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

const FileRow = memo(function FileRow({
  entry,
  statusKey,
  onClick,
}: {
  entry: GitStatusEntry;
  statusKey: "staged" | "unstaged";
  onClick: (path: string) => void;
}) {
  const statusValue = entry[statusKey];
  const label = statusValue ? STATUS_LABELS[statusValue] ?? "?" : "?";
  const color = statusValue ? STATUS_COLORS[statusValue] ?? "" : "";
  const dir = fileDir(entry.path);

  return (
    <button
      type="button"
      className="flex items-center w-full px-2 py-0.5 text-left text-xs hover:bg-[var(--cf-hover)] transition-colors rounded group"
      onClick={() => onClick(entry.path)}
      title={`${statusKey === "staged" ? "Unstage" : "Stage"} ${entry.path}`}
    >
      <span className={cn("w-4 shrink-0 font-mono font-semibold", color)}>
        {label}
      </span>
      <span className="truncate ml-1">
        {fileBasename(entry.path)}
      </span>
      {dir && (
        <span className="ml-1 text-[var(--cf-muted)] truncate text-[10px]">
          {dir}
        </span>
      )}
    </button>
  );
});

export function GitPanel({ git }: GitPanelProps) {
  const [message, setMessage] = useState("");
  const { status, loading, error } = git;

  const { staged, unstaged } = useMemo(() => {
    if (!status) return { staged: [], unstaged: [] };
    const s: GitStatusEntry[] = [];
    const u: GitStatusEntry[] = [];
    for (const f of status.files) {
      if (f.staged) s.push(f);
      if (f.unstaged) u.push(f);
    }
    return { staged: s, unstaged: u };
  }, [status]);

  const handleStage = useCallback((path: string) => {
    void git.stage([path]);
  }, [git.stage]);

  const handleUnstage = useCallback((path: string) => {
    void git.unstage([path]);
  }, [git.unstage]);

  const handleStageAll = useCallback(() => {
    void git.stage(unstaged.map((f) => f.path));
  }, [git.stage, unstaged]);

  const handleUnstageAll = useCallback(() => {
    void git.unstage(staged.map((f) => f.path));
  }, [git.unstage, staged]);

  const handleCommit = useCallback(() => {
    if (!message.trim() || staged.length === 0 || loading) return;
    void git.commit(message).then((oid) => {
      if (oid) setMessage("");
    });
  }, [git.commit, message, staged.length, loading]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleCommit();
    }
  }, [handleCommit]);

  if (!status) {
    return (
      <div className="p-3 text-xs text-[var(--cf-muted)]">
        {loading ? "Loading..." : "No project open"}
      </div>
    );
  }

  if (!status.isRepo) {
    return (
      <div className="p-3 text-xs text-[var(--cf-muted)]">
        Not a git repository
      </div>
    );
  }

  const canCommit = staged.length > 0 && message.trim().length > 0 && !loading;

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Branch */}
      <div className="flex items-center justify-between px-3 py-1.5 text-[var(--cf-muted)] border-b border-[var(--cf-border)]">
        <span className="font-mono truncate">{status.branch ?? "HEAD"}</span>
        <button
          type="button"
          onClick={() => { void git.refresh(); }}
          disabled={loading}
          className="text-[10px] hover:text-[var(--cf-fg)] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          Refresh
        </button>
      </div>

      {/* Commit area */}
      <div className="px-2 pt-2 pb-1 border-b border-[var(--cf-border)]">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Commit message"
          rows={3}
          className="w-full resize-none rounded border border-[var(--cf-border)] bg-[var(--cf-bg)] px-2 py-1 text-xs text-[var(--cf-fg)] placeholder:text-[var(--cf-muted)] focus:outline-none focus:border-[var(--cf-accent)]"
        />
        <button
          type="button"
          disabled={!canCommit}
          onClick={handleCommit}
          className={cn(
            "w-full mt-1 px-2 py-1 rounded text-xs font-medium transition-colors",
            canCommit
              ? "bg-[var(--cf-accent)] text-white hover:opacity-90"
              : "bg-[var(--cf-hover)] text-[var(--cf-muted)] cursor-not-allowed",
          )}
        >
          {loading ? "Committing..." : "Commit"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-2 py-1 text-red-600 dark:text-red-400 border-b border-[var(--cf-border)]">
          {error}
        </div>
      )}

      {/* File lists */}
      <div className="flex-1 overflow-y-auto">
        {/* Staged */}
        {staged.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 py-1 font-semibold text-[var(--cf-muted)] uppercase tracking-wide">
              <span>Staged ({staged.length})</span>
              <button
                type="button"
                onClick={handleUnstageAll}
                className="text-[10px] normal-case tracking-normal hover:text-[var(--cf-fg)] transition-colors"
                title="Unstage all"
              >
                Unstage All
              </button>
            </div>
            {staged.map((f) => (
              <FileRow
                key={`staged-${f.path}`}
                entry={f}
                statusKey="staged"
                onClick={handleUnstage}
              />
            ))}
          </div>
        )}

        {/* Unstaged */}
        {unstaged.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 py-1 font-semibold text-[var(--cf-muted)] uppercase tracking-wide">
              <span>Changes ({unstaged.length})</span>
              <button
                type="button"
                onClick={handleStageAll}
                className="text-[10px] normal-case tracking-normal hover:text-[var(--cf-fg)] transition-colors"
                title="Stage all"
              >
                Stage All
              </button>
            </div>
            {unstaged.map((f) => (
              <FileRow
                key={`unstaged-${f.path}`}
                entry={f}
                statusKey="unstaged"
                onClick={handleStage}
              />
            ))}
          </div>
        )}

        {/* Clean state */}
        {staged.length === 0 && unstaged.length === 0 && (
          <div className="p-3 text-[var(--cf-muted)]">
            No changes
          </div>
        )}
      </div>
    </div>
  );
}
