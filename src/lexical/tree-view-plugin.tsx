/**
 * tree-view-plugin — Renders a real Lexical tree inspector panel when the
 * `treeView` dev setting is enabled.
 *
 * Uses @lexical/react/LexicalTreeView which reflects the actual Lexical
 * node tree, selection state, and editor identity for the active surface.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TreeView } from "@lexical/react/LexicalTreeView";
import { useDevSettings } from "../app/dev-settings";

export function TreeViewPlugin() {
  const open = useDevSettings((s) => s.treeView);
  const [editor] = useLexicalComposerContext();

  if (!open) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[120] w-[520px] rounded-lg border border-[var(--cf-border)] bg-[var(--cf-bg)] shadow-lg">
      <div className="flex items-center justify-between border-b border-[var(--cf-border)] px-3 py-2">
        <div>
          <div className="text-sm font-semibold text-[var(--cf-fg)]">
            Lexical Tree
          </div>
          <div className="text-xs text-[var(--cf-muted)]">
            {editor._config.namespace}
          </div>
        </div>
        <button
          type="button"
          onClick={() => useDevSettings.getState().toggle("treeView")}
          className="rounded border border-[var(--cf-border)] px-2 py-1 text-xs text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]"
        >
          Close
        </button>
      </div>
      <div className="max-h-[60vh] overflow-auto p-3">
        <TreeView
          viewClassName="cf-tree-view text-xs font-mono whitespace-pre-wrap text-[var(--cf-fg)]"
          treeTypeButtonClassName="rounded border border-[var(--cf-border)] px-2 py-1 text-xs text-[var(--cf-fg)] hover:bg-[var(--cf-hover)] mr-1"
          timeTravelButtonClassName="rounded border border-[var(--cf-border)] px-2 py-1 text-xs text-[var(--cf-fg)] hover:bg-[var(--cf-hover)] mr-1"
          timeTravelPanelButtonClassName="rounded border border-[var(--cf-border)] px-2 py-1 text-xs text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]"
          timeTravelPanelClassName="mt-2 p-2 rounded border border-[var(--cf-border)] bg-[var(--cf-bg)]"
          timeTravelPanelSliderClassName="w-full"
          editor={editor}
        />
      </div>
    </div>
  );
}
