import type { EditorView } from "@codemirror/view";

import { exportDocument, batchExport, type ExportFormat } from "./export";
import { revealInFinder, isTauri } from "./tauri-fs";
import type { FileSystem } from "./file-manager";
import type { TabBar } from "./tab-bar";

/** Narrow context needed by export operations. */
export interface ExportContext {
  readonly fs: FileSystem;
  readonly tabBar: TabBar;
  readonly editorContainer: HTMLElement;
  editor: EditorView | null;
}

/** Extract a human-readable message from an unknown error value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Show a temporary notification bar at the top of the editor container. */
export function showNotification(container: HTMLElement, message: string, isError = false): void {
  const bar = document.createElement("div");
  bar.className = `app-notification${isError ? " app-notification-error" : ""}`;
  bar.textContent = message;
  container.prepend(bar);
  setTimeout(() => bar.remove(), 5000);
}

/** Export the active document to the given format. */
export async function doExportActiveFile(ctx: ExportContext, format: ExportFormat): Promise<void> {
  const activePath = ctx.tabBar.getActiveTab();
  if (!activePath || !ctx.editor) return;

  const content = ctx.editor.state.doc.toString();

  try {
    const outputPath = await exportDocument(content, format, activePath, ctx.fs);
    showNotification(ctx.editorContainer, `Exported to ${outputPath}`);
  } catch (err: unknown) {
    showNotification(ctx.editorContainer, `Export failed: ${errorMessage(err)}`, true);
  }
}

/** Batch-export all .md files in the project. */
export async function doBatchExportAll(ctx: ExportContext, format: ExportFormat): Promise<void> {
  let tree;
  try {
    tree = await ctx.fs.listTree();
  } catch (err: unknown) {
    showNotification(ctx.editorContainer, `Batch export failed: ${errorMessage(err)}`, true);
    return;
  }

  showNotification(ctx.editorContainer, `Batch export started…`);

  const results = await batchExport(tree, format, ctx.fs);
  const succeeded = results.filter((r) => r.outputPath !== undefined).length;
  const failed = results.length - succeeded;

  if (failed === 0) {
    showNotification(ctx.editorContainer, `Batch export complete: ${succeeded} file(s) exported.`);
  } else {
    showNotification(
      ctx.editorContainer,
      `Batch export: ${succeeded} succeeded, ${failed} failed.`,
      true,
    );
  }
}

/** Reveal the active file in the OS file explorer (Tauri only). */
export async function doRevealActiveFile(ctx: ExportContext, path?: string): Promise<void> {
  if (!isTauri()) return;
  const target = path ?? ctx.tabBar.getActiveTab();
  if (!target) return;
  try {
    await revealInFinder(target);
  } catch (err: unknown) {
    showNotification(ctx.editorContainer, `Could not reveal file: ${errorMessage(err)}`, true);
  }
}
