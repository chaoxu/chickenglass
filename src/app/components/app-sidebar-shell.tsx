import { lazy, memo, Suspense, useCallback } from "react";
import { Diagnostics } from "./diagnostics";
import { FileTree } from "./file-tree";
import { RuntimeLogs } from "./runtime-logs";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "./sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  useAppSidebarDiagnostics,
  useAppSidebarFileTree,
  useAppSidebarOutline,
} from "../contexts/app-sidebar-context";
import { usePersistentTreeState } from "../hooks/use-file-tree-controller";
import type { SidebarLayoutController, SidebarTab } from "../hooks/use-sidebar-layout";
import { isRuntimeLogPanelEnabled } from "../runtime-logger";

const Outline = lazy(() =>
  import("./outline").then((module) => ({
    default: module.Outline,
  })),
);

interface AppSidebarShellProps {
  sidebarLayout: Pick<
    SidebarLayoutController,
    "sidebarTab" | "setSidebarTab"
  >;
}

const FileTreeSidebarPane = memo(function FileTreeSidebarPane() {
  const sidebar = useAppSidebarFileTree();
  const fileTreePersistRef = usePersistentTreeState();
  const openFile = useCallback((path: string) => {
    void sidebar.openFile(path);
  }, [sidebar]);
  const createFile = useCallback((path: string) => {
    void sidebar.createFile(path);
  }, [sidebar]);
  const createDirectory = useCallback((path: string) => {
    void sidebar.createDirectory(path);
  }, [sidebar]);
  const loadChildren = useCallback((dirPath: string) => {
    void sidebar.loadChildren(dirPath);
  }, [sidebar]);

  return (
    <FileTree
      root={sidebar.fileTree}
      activePath={sidebar.activePath}
      onSelect={openFile}
      onDoubleClick={openFile}
      onRename={sidebar.handleRename}
      onDelete={sidebar.handleDelete}
      onCreateFile={createFile}
      onCreateDir={createDirectory}
      persistRef={fileTreePersistRef}
      onLoadChildren={loadChildren}
    />
  );
});

const OutlineSidebarPane = memo(function OutlineSidebarPane() {
  const outline = useAppSidebarOutline();

  return <Outline headings={outline.headings} onSelect={outline.onSelect} />;
});

const DiagnosticsSidebarPane = memo(function DiagnosticsSidebarPane() {
  const diagnostics = useAppSidebarDiagnostics();

  return (
    <Diagnostics
      diagnostics={diagnostics.diagnostics}
      onSelect={diagnostics.onSelect}
    />
  );
});

export const AppSidebarShell = memo(function AppSidebarShell({
  sidebarLayout,
}: AppSidebarShellProps) {
  const showRuntimeLogs = isRuntimeLogPanelEnabled();

  return (
    <div data-sidebar className="flex shrink-0">
      <Sidebar>
        <SidebarHeader>
          <span className="overflow-hidden whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[var(--cf-muted)] pl-1">
            Explorer
          </span>
          <SidebarTrigger />
        </SidebarHeader>

        <Tabs
          value={sidebarLayout.sidebarTab}
          onValueChange={(value) => {
            sidebarLayout.setSidebarTab(value as SidebarTab);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="flex w-full min-w-0 shrink-0 border-b border-[var(--cf-border)]">
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="outline">Outline</TabsTrigger>
            <TabsTrigger
              value="diagnostics"
              aria-label="Diagnostics"
              title="Diagnostics"
            >
              Issues
            </TabsTrigger>
            {showRuntimeLogs ? (
              <TabsTrigger
                value="runtime"
                aria-label="Runtime"
                title="Runtime"
              >
                Logs
              </TabsTrigger>
            ) : null}
          </TabsList>

          <SidebarContent>
            <TabsContent value="files" className="min-h-full">
              <FileTreeSidebarPane />
            </TabsContent>
            <TabsContent value="outline" className="min-h-full">
              <Suspense
                fallback={
                  <div className="px-3 py-2 text-xs text-[var(--cf-muted)] italic">
                    No headings
                  </div>
                }
              >
                <OutlineSidebarPane />
              </Suspense>
            </TabsContent>
            <TabsContent value="diagnostics" className="min-h-full">
              <DiagnosticsSidebarPane />
            </TabsContent>
            {showRuntimeLogs ? (
              <TabsContent value="runtime" className="min-h-full">
                <RuntimeLogs />
              </TabsContent>
            ) : null}
          </SidebarContent>
        </Tabs>
      </Sidebar>
      <SidebarRail />
    </div>
  );
});
