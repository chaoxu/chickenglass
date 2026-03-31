import { FileTree } from "./file-tree";
import { GitPanel } from "./git-panel";
import { Outline } from "./outline";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "./sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import type { AppEditorShellController } from "../hooks/use-app-editor-shell";
import type { GitController } from "../hooks/use-git";
import type {
  AppWorkspaceSessionController,
  SidebarTab,
} from "../hooks/use-app-workspace-session";
import { usePersistentTreeState } from "../hooks/use-file-tree-controller";

interface AppSidebarShellProps {
  workspace: Pick<
    AppWorkspaceSessionController,
    "sidebarTab" | "setSidebarTab" | "fileTree" | "loadChildren" | "gitStatus"
  >;
  editor: Pick<
    AppEditorShellController,
    "currentPath" | "openFile" | "handleRename" | "handleDelete" | "createFile" | "createDirectory" | "headings" | "handleOutlineSelect" | "editorState"
  >;
  git: GitController | null;
}

export function AppSidebarShell({ workspace, editor, git }: AppSidebarShellProps) {
  const fileTreePersistRef = usePersistentTreeState();

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
          value={workspace.sidebarTab}
          onValueChange={(value) => {
            workspace.setSidebarTab(value as SidebarTab);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="flex shrink-0 border-b border-[var(--cf-border)]">
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="outline">Outline</TabsTrigger>
            {git && <TabsTrigger value="git">Git</TabsTrigger>}
          </TabsList>

          <SidebarContent>
            <TabsContent value="files" className="min-h-full">
              <FileTree
                root={workspace.fileTree}
                gitStatus={workspace.gitStatus}
                activePath={editor.currentPath}
                onSelect={(path) => { void editor.openFile(path); }}
                onDoubleClick={(path) => { void editor.openFile(path); }}
                onRename={editor.handleRename}
                onDelete={editor.handleDelete}
                onCreateFile={(path) => { void editor.createFile(path); }}
                onCreateDir={(path) => { void editor.createDirectory(path); }}
                persistRef={fileTreePersistRef}
                onLoadChildren={(dirPath) => { void workspace.loadChildren(dirPath); }}
              />
            </TabsContent>
            <TabsContent value="outline" className="min-h-full">
              <Outline headings={editor.headings} onSelect={editor.handleOutlineSelect} />
            </TabsContent>
            {git && (
              <TabsContent value="git" className="min-h-full">
                <GitPanel git={git} />
              </TabsContent>
            )}
          </SidebarContent>
        </Tabs>
      </Sidebar>
      <SidebarRail />
    </div>
  );
}
