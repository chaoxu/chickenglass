import { useEffect, useState } from "react";
import {
  clearCombinedPerf,
  getCombinedPerfSnapshot,
  perfPanelRefreshEventName,
  perfPanelToggleEventName,
  type CombinedPerfSnapshot,
} from "../perf";

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

export function PerfDebugPanel() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<CombinedPerfSnapshot | null>(null);

  useEffect(() => {
    const toggleEvent = perfPanelToggleEventName();
    const refreshEvent = perfPanelRefreshEventName();

    const toggle = () => setOpen((value) => !value);
    const refresh = () => {
      if (!open) return;
      void getCombinedPerfSnapshot().then(setSnapshot);
    };

    window.addEventListener(toggleEvent, toggle);
    window.addEventListener(refreshEvent, refresh);
    return () => {
      window.removeEventListener(toggleEvent, toggle);
      window.removeEventListener(refreshEvent, refresh);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const load = () => {
      void getCombinedPerfSnapshot().then(setSnapshot);
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
    <div className="fixed bottom-4 right-4 z-[120] w-[460px] rounded-lg border border-[var(--cg-border)] bg-[var(--cg-bg)] shadow-lg">
      <div className="flex items-center justify-between border-b border-[var(--cg-border)] px-3 py-2">
        <div>
          <div className="text-sm font-semibold text-[var(--cg-fg)]">Perf Debug</div>
          <div className="text-xs text-[var(--cg-muted)]">
            Aggregated frontend and Tauri timings
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => { void getCombinedPerfSnapshot().then(setSnapshot); }}
            className="rounded border border-[var(--cg-border)] px-2 py-1 text-[var(--cg-fg)] hover:bg-[var(--cg-hover)]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => { void clearCombinedPerf().then(() => getCombinedPerfSnapshot().then(setSnapshot)); }}
            className="rounded border border-[var(--cg-border)] px-2 py-1 text-[var(--cg-fg)] hover:bg-[var(--cg-hover)]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-[var(--cg-border)] px-2 py-1 text-[var(--cg-fg)] hover:bg-[var(--cg-hover)]"
          >
            Close
          </button>
        </div>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-auto p-3 text-xs">
        <section>
          <div className="mb-2 font-medium text-[var(--cg-fg)]">Recent operations</div>
          <div className="space-y-1">
            {recentOperations.length === 0 ? (
              <div className="text-[var(--cg-muted)]">No frontend operations recorded yet.</div>
            ) : recentOperations.map((operation) => (
              <div key={operation.id} className="flex items-center justify-between gap-4">
                <span className="truncate text-[var(--cg-fg)]">{operation.name}</span>
                <span className="tabular-nums text-[var(--cg-muted)]">
                  {formatMs(operation.durationMs)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 font-medium text-[var(--cg-fg)]">Frontend spans</div>
          <div className="space-y-1">
            {frontendSummaries.length === 0 ? (
              <div className="text-[var(--cg-muted)]">No frontend spans recorded yet.</div>
            ) : frontendSummaries.map((entry) => (
              <div key={`frontend-${entry.name}`} className="grid grid-cols-[1fr_auto_auto] gap-3">
                <span className="truncate text-[var(--cg-fg)]">{entry.name}</span>
                <span className="tabular-nums text-[var(--cg-muted)]">
                  avg {formatMs(entry.avgMs)}
                </span>
                <span className="tabular-nums text-[var(--cg-muted)]">
                  max {formatMs(entry.maxMs)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 font-medium text-[var(--cg-fg)]">Backend spans</div>
          <div className="space-y-1">
            {backendSummaries.length === 0 ? (
              <div className="text-[var(--cg-muted)]">No Tauri spans recorded yet.</div>
            ) : backendSummaries.map((entry) => (
              <div key={`backend-${entry.name}`} className="grid grid-cols-[1fr_auto_auto] gap-3">
                <span className="truncate text-[var(--cg-fg)]">{entry.name}</span>
                <span className="tabular-nums text-[var(--cg-muted)]">
                  avg {formatMs(entry.avgMs)}
                </span>
                <span className="tabular-nums text-[var(--cg-muted)]">
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
