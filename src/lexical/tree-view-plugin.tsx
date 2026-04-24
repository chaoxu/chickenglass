/**
 * tree-view-plugin — Renders a real Lexical tree inspector panel when the
 * `treeView` dev setting is enabled.
 *
 * Uses @lexical/react/LexicalTreeView which reflects the actual Lexical
 * node tree, selection state, and editor identity for the active surface.
 *
 * Portals into the debug sidebar when available (via React context).
 */

import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TreeView } from "@lexical/react/LexicalTreeView";
import { useDevSettings } from "../state/dev-settings";
import { useTreeViewPortalTarget } from "../debug/tree-view-portal-context";

export function TreeViewPlugin() {
  const open = useDevSettings((s) => s.treeView);
  const [editor] = useLexicalComposerContext();
  const portalTarget = useTreeViewPortalTarget();

  if (!open) return null;

  const content = (
    <div className="p-3">
      <div className="mb-2 text-xs font-medium text-[var(--cf-fg)]">
        Tree: {editor._config.namespace}
      </div>
      <div className="max-h-[50vh] overflow-auto">
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

  if (portalTarget) {
    return createPortal(content, portalTarget);
  }

  return null;
}
