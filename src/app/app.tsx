import { FileSystemProvider } from "./contexts/file-system-context";
import type { FileSystem } from "./file-manager";

interface AppShellProps {
  fs: FileSystem;
}

export function AppShell({ fs }: AppShellProps) {
  return (
    <FileSystemProvider value={fs}>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <div className="w-[220px] shrink-0 bg-[var(--cg-subtle)] border-r border-[var(--cg-border)] flex flex-col overflow-hidden">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--cg-muted)] border-b border-[var(--cg-border)]">
            Files
          </div>
          <div className="flex-1 overflow-y-auto p-2 text-sm text-[var(--cg-muted)]">
            Sidebar
          </div>
        </div>

        {/* Main area */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Tab bar */}
          <div className="shrink-0 bg-[var(--cg-subtle)] border-b border-[var(--cg-border)] min-h-[32px] flex items-center px-2 text-sm text-[var(--cg-muted)]">
            Tab Bar
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-hidden relative bg-[var(--cg-bg)] flex items-center justify-center text-[var(--cg-muted)] text-sm">
            Editor
          </div>

          {/* Status bar */}
          <div className="shrink-0 border-t border-[var(--cg-border)] bg-[var(--cg-subtle)] min-h-[24px] flex items-center px-3 text-xs text-[var(--cg-muted)]">
            Status Bar
          </div>
        </div>
      </div>
    </FileSystemProvider>
  );
}
