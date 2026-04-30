import { useCallback, useState, type ReactNode, type RefCallback } from "react";
import { useDevSettings } from "../../state/dev-settings";
import { PerfDebugPanelContent } from "./perf-debug-panel";
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

function DebugSidebarPanel({ treeViewRef }: { readonly treeViewRef: RefCallback<HTMLDivElement> }) {
  const treeView = useDevSettings((s) => s.treeView);
  const perfPanel = useDevSettings((s) => s.perfPanel);

  if (!treeView && !perfPanel) return null;

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
      </div>
    </div>
  );
}
