import { FileTree } from "./file-tree";
import { Outline } from "./outline";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "./sidebar";
import { SymbolPanel } from "./symbol-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import type { AppEditorShellController } from "../hooks/use-app-editor-shell";
import type {
  AppWorkspaceSessionController,
  SidebarTab,
} from "../hooks/use-app-workspace-session";

interface AppSidebarShellProps {
  workspace: Pick<
    AppWorkspaceSessionController,
    "sidebarTab" | "setSidebarTab" | "fileTree"
  >;
  editor: Pick<
    AppEditorShellController,
    "activeTab" | "openFile" | "handleRename" | "handleDelete" | "createFile" | "createDirectory" | "headings" | "handleOutlineSelect" | "handleSymbolInsert" | "editorState"
  >;
}

export function AppSidebarShell({ workspace, editor }: AppSidebarShellProps) {
  return (
    <div className="flex shrink-0">
      <Sidebar>
        <SidebarHeader>
          <span className="overflow-hidden whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[var(--cf-muted)]">
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
            <TabsTrigger value="symbols">Symbols</TabsTrigger>
          </TabsList>

          <SidebarContent>
            <TabsContent value="files" className="min-h-full">
              <FileTree
                root={workspace.fileTree}
                activePath={editor.activeTab}
                onSelect={(path) => { void editor.openFile(path, { preview: true }); }}
                onDoubleClick={(path) => { void editor.openFile(path, { preview: false }); }}
                onRename={editor.handleRename}
                onDelete={editor.handleDelete}
                onCreateFile={(path) => { void editor.createFile(path); }}
                onCreateDir={(path) => { void editor.createDirectory(path); }}
              />
            </TabsContent>
            <TabsContent value="outline" className="min-h-full">
              <Outline headings={editor.headings} onSelect={editor.handleOutlineSelect} />
            </TabsContent>
            <TabsContent value="symbols" className="min-h-full">
              <SymbolPanel
                onInsert={editor.handleSymbolInsert}
                view={editor.editorState?.view ?? null}
              />
            </TabsContent>
          </SidebarContent>
        </Tabs>
      </Sidebar>
      <SidebarRail />
    </div>
  );
}
