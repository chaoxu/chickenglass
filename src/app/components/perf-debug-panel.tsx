import { useEffect, useState } from "react";
import { logCatchError } from "../lib/log-catch-error";
import {
  clearCombinedPerf,
  getCombinedPerfSnapshot,
  perfPanelRefreshEventName,
  type CombinedPerfSnapshot,
} from "../perf";
import { useDevSettings } from "../dev-settings";

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

export function PerfDebugPanel() {
  const open = useDevSettings((s) => s.perfPanel);
  const [snapshot, setSnapshot] = useState<CombinedPerfSnapshot | null>(null);

  useEffect(() => {
    const refreshEvent = perfPanelRefreshEventName();

    const refresh = () => {
      if (!open) return;
      void getCombinedPerfSnapshot().then(setSnapshot).catch(
        logCatchError("[perf] failed to refresh snapshot"),
      );
    };

    window.addEventListener(refreshEvent, refresh);
    return () => {
      window.removeEventListener(refreshEvent, refresh);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const load = () => {
      void getCombinedPerfSnapshot().then(setSnapshot).catch(
        logCatchError("[perf] failed to load snapshot"),
      );
    };

    load();
    const timer = window.setInterval(load, 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!open || !snapshot) return null;

  const frontendSummaries = snapshot.frontend.summaries.slice(0, 8);
  const backendSummaries = snapshot.backend?.summaries.slice(0, 8) ?? [];
  const recentOperations = snapshot.frontend.operations.slice(0, 8);

  return (
    <div className="fixed bottom-4 right-4 z-[120] w-[460px] rounded-lg border border-[var(--cf-border)] bg-[var(--cf-bg)] shadow-lg">
      <div className="flex items-center justify-between border-b border-[var(--cf-border)] px-3 py-2">
        <div>
          <div className="text-sm font-semibold text-[var(--cf-fg)]">Perf Debug</div>
          <div className="text-xs text-[var(--cf-muted)]">
            Aggregated frontend and Tauri timings
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              void getCombinedPerfSnapshot().then(setSnapshot).catch(
                logCatchError("[perf] failed to refresh snapshot"),
              );
            }}
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
          <button
            type="button"
            onClick={() => useDevSettings.getState().toggle("perfPanel")}
            className="rounded border border-[var(--cf-border)] px-2 py-1 text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]"
          >
            Close
          </button>
        </div>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-auto p-3 text-xs">
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
    </div>
  );
}
