import { memo, useSyncExternalStore } from "react";
import {
  clearRuntimeLogs,
  getRuntimeLogsSnapshot,
  subscribeRuntimeLogs,
} from "../runtime-logger";

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour12: false });
  return `${time}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export const RuntimeLogs = memo(function RuntimeLogs() {
  const logs = useSyncExternalStore(subscribeRuntimeLogs, getRuntimeLogsSnapshot);

  if (logs.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cf-muted)] italic">
        No runtime errors yet
      </div>
    );
  }

  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-3 py-1 text-[10px] font-mono tabular-nums text-[var(--cf-muted)]">
        <span>{logs.length} runtime error{logs.length !== 1 ? "s" : ""}</span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors hover:bg-[var(--cf-hover)] hover:text-[var(--cf-fg)]"
          onClick={() => clearRuntimeLogs()}
        >
          Clear
        </button>
      </div>
      {logs.map((entry) => (
        <div
          key={entry.id}
          className="border-b border-[var(--cf-border)] px-3 py-2 last:border-b-0"
        >
          <div className="mb-1 flex items-center gap-2 text-[10px] font-mono tabular-nums text-[var(--cf-muted)]">
            <span>{formatTimestamp(entry.timestamp)}</span>
            <span className="rounded border border-[var(--cf-border)] px-1 py-[1px]">
              {entry.source}
            </span>
          </div>
          <div className="break-words text-sm text-[var(--cf-fg)] cf-ui-font">
            {entry.message}
          </div>
          {entry.stack ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer select-none text-[var(--cf-muted)]">
                Stack trace
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-[var(--cf-bg-secondary)] p-2 font-mono text-[11px] leading-5 text-[var(--cf-fg)]">
                {entry.stack}
              </pre>
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
});
