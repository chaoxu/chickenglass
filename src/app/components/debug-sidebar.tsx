import { useCallback, useEffect, useState, type ReactNode, type RefCallback } from "react";
import { useDevSettings } from "../../state/dev-settings";
import { PerfDebugPanelContent } from "./perf-debug-panel";
import { getInteractionLog, type InteractionTraceEntry } from "../../lexical/interaction-trace";
import { TreeViewPortalTargetProvider } from "../../debug/tree-view-portal-context";

export function DebugSidebarProvider({ children }: { readonly children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  const treeViewRef: RefCallback<HTMLDivElement> = useCallback((el) => {
    setTarget(el);
  }, []);

  return (
    <TreeViewPortalTargetProvider value={target}>
      <div className="flex min-h-0 flex-1">
        {children}
        <DebugSidebarPanel treeViewRef={treeViewRef} />
      </div>
    </TreeViewPortalTargetProvider>
  );
}

function InteractionTracePanel() {
  const [entries, setEntries] = useState<readonly InteractionTraceEntry[]>([]);

  useEffect(() => {
    const refresh = () => setEntries(getInteractionLog().slice(-10));
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-1 p-3 text-xs">
      <div className="font-medium text-[var(--cf-fg)]">Interactions</div>
      {entries.length === 0 ? (
        <div className="text-[var(--cf-muted)]">No interactions recorded yet.</div>
      ) : entries.map((e, i) => {
        const delta = e.scrollAfter - e.scrollBefore;
        return (
          <div key={`${e.ts}-${i}`} className="flex items-center gap-2">
            <span className="tabular-nums text-[var(--cf-muted)]">
              {new Date(e.ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className="truncate text-[var(--cf-fg)]">{e.nodeType ?? e.target}</span>
            {e.type === "input" && (
              <span className="truncate text-[var(--cf-muted)]">
                {e.inputType}{e.data ? ` ${JSON.stringify(e.data)}` : ""}
              </span>
            )}
            {delta !== 0 && (
              <span className="tabular-nums font-medium text-red-500">
                {delta > 0 ? "+" : ""}{delta}px
              </span>
            )}
            {e.handled && <span className="text-[var(--cf-muted)]">(h)</span>}
          </div>
        );
      })}
    </div>
  );
}

function DebugSidebarPanel({ treeViewRef }: { readonly treeViewRef: RefCallback<HTMLDivElement> }) {
  const treeView = useDevSettings((s) => s.treeView);
  const perfPanel = useDevSettings((s) => s.perfPanel);
  const commandLogging = useDevSettings((s) => s.commandLogging);

  if (!treeView && !perfPanel && !commandLogging) return null;

  return (
    <div className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-[var(--cf-border)] bg-[var(--cf-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--cf-border)] px-3 py-1.5">
        <span className="text-xs font-semibold text-[var(--cf-fg)]">Debug</span>
      </div>
      <div className="flex flex-1 flex-col overflow-auto">
        {treeView && (
          <section className="border-b border-[var(--cf-border)]">
            <div ref={treeViewRef} />
          </section>
        )}
        {perfPanel && (
          <section className="border-b border-[var(--cf-border)]">
            <PerfDebugPanelContent />
          </section>
        )}
        {commandLogging && (
          <section className="flex-1 overflow-auto">
            <InteractionTracePanel />
          </section>
        )}
      </div>
    </div>
  );
}
