import { Diagnostics } from "./diagnostics";
import { FileTree } from "./file-tree";
import { Outline } from "./outline";
import { RuntimeLogs } from "./runtime-logs";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "./sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { useAppEditorController } from "../contexts/app-editor-context";
import { useAppWorkspaceController } from "../contexts/app-workspace-context";
import { usePersistentTreeState } from "../hooks/use-file-tree-controller";
import type { SidebarLayoutController, SidebarTab } from "../hooks/use-sidebar-layout";
import { isRuntimeLogPanelEnabled } from "../runtime-logger";

interface AppSidebarShellProps {
  sidebarLayout: Pick<
    SidebarLayoutController,
    "sidebarTab" | "setSidebarTab"
  >;
}

export function AppSidebarShell({ sidebarLayout }: AppSidebarShellProps) {
  const workspace = useAppWorkspaceController();
  const editor = useAppEditorController();
  const fileTreePersistRef = usePersistentTreeState();
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
          <TabsList className="flex shrink-0 border-b border-[var(--cf-border)]">
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="outline">Outline</TabsTrigger>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            {showRuntimeLogs ? <TabsTrigger value="runtime">Runtime</TabsTrigger> : null}
          </TabsList>

          <SidebarContent>
            <TabsContent value="files" className="min-h-full">
              <FileTree
                root={workspace.fileTree}
                activePath={editor.state.currentPath}
                onSelect={(path) => { void editor.files.openFile(path); }}
                onDoubleClick={(path) => { void editor.files.openFile(path); }}
                onRename={editor.files.handleRename}
                onDelete={editor.files.handleDelete}
                onCreateFile={(path) => { void editor.files.createFile(path); }}
                onCreateDir={(path) => { void editor.files.createDirectory(path); }}
                persistRef={fileTreePersistRef}
                onLoadChildren={(dirPath) => { void workspace.loadChildren(dirPath); }}
              />
            </TabsContent>
            <TabsContent value="outline" className="min-h-full">
              <Outline headings={editor.state.headings} onSelect={editor.navigation.handleOutlineSelect} />
            </TabsContent>
            <TabsContent value="diagnostics" className="min-h-full">
              <Diagnostics diagnostics={editor.state.diagnostics} onSelect={editor.navigation.handleOutlineSelect} />
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
}
