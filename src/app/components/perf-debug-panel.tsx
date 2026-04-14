import { useCallback, useEffect, useState } from "react";
import { logCatchError } from "../lib/log-catch-error";
import {
  clearCombinedPerf,
  getCombinedPerfSnapshot,
  perfPanelRefreshEventName,
  type CombinedPerfSnapshot,
} from "../perf";

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

export function PerfDebugPanelContent() {
  const [snapshot, setSnapshot] = useState<CombinedPerfSnapshot | null>(null);

  const refresh = useCallback(() => {
    void getCombinedPerfSnapshot().then(setSnapshot).catch(
      logCatchError("[perf] failed to refresh snapshot"),
    );
  }, []);

  useEffect(() => {
    const refreshEvent = perfPanelRefreshEventName();

    refresh();
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener(refreshEvent, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(refreshEvent, refresh);
    };
  }, [refresh]);

  if (!snapshot) return null;

  const frontendSummaries = snapshot.frontend.summaries.slice(0, 8);
  const backendSummaries = snapshot.backend?.summaries.slice(0, 8) ?? [];
  const recentOperations = snapshot.frontend.operations.slice(0, 8);

  return (
    <div className="space-y-4 p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-[var(--cf-fg)]">Perf</div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-[var(--cf-border)] px-2 py-1 text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              void clearCombinedPerf()
                .then(() => getCombinedPerfSnapshot())
                .then(setSnapshot)
                .catch(logCatchError("[perf] failed to clear/refresh snapshot"));
            }}
            className="rounded border border-[var(--cf-border)] px-2 py-1 text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]"
          >
            Clear
          </button>
        </div>
      </div>

      <section>
        <div className="mb-2 font-medium text-[var(--cf-fg)]">Recent operations</div>
        <div className="space-y-1">
          {recentOperations.length === 0 ? (
            <div className="text-[var(--cf-muted)]">No frontend operations recorded yet.</div>
          ) : recentOperations.map((operation) => (
            <div key={operation.id} className="flex items-center justify-between gap-4">
              <span className="truncate text-[var(--cf-fg)]">{operation.name}</span>
              <span className="tabular-nums text-[var(--cf-muted)]">
                {formatMs(operation.durationMs)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 font-medium text-[var(--cf-fg)]">Frontend spans</div>
        <div className="space-y-1">
          {frontendSummaries.length === 0 ? (
            <div className="text-[var(--cf-muted)]">No frontend spans recorded yet.</div>
          ) : frontendSummaries.map((entry) => (
            <div key={`frontend-${entry.name}`} className="grid grid-cols-[1fr_auto_auto] gap-3">
              <span className="truncate text-[var(--cf-fg)]">{entry.name}</span>
              <span className="tabular-nums text-[var(--cf-muted)]">
                avg {formatMs(entry.avgMs)}
              </span>
              <span className="tabular-nums text-[var(--cf-muted)]">
                max {formatMs(entry.maxMs)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 font-medium text-[var(--cf-fg)]">Backend spans</div>
        <div className="space-y-1">
          {backendSummaries.length === 0 ? (
            <div className="text-[var(--cf-muted)]">No Tauri spans recorded yet.</div>
          ) : backendSummaries.map((entry) => (
            <div key={`backend-${entry.name}`} className="grid grid-cols-[1fr_auto_auto] gap-3">
              <span className="truncate text-[var(--cf-fg)]">{entry.name}</span>
              <span className="tabular-nums text-[var(--cf-muted)]">
                avg {formatMs(entry.avgMs)}
              </span>
              <span className="tabular-nums text-[var(--cf-muted)]">
                max {formatMs(entry.maxMs)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
