import { describe, expect, it } from "vitest";

import {
  type CoflatRichPluginId,
  getCoflatRichPluginPlan,
} from "./lexical-composer-shell";

const editorDeltas = new Set<CoflatRichPluginId>([
  "clipboard",
  "history",
  "table-scroll-shadow",
  "table-action-menu",
]);

function withoutEditorDeltas(plan: readonly CoflatRichPluginId[]): readonly CoflatRichPluginId[] {
  return plan.filter((pluginId) => !editorDeltas.has(pluginId));
}

describe("coflat rich composer plugin plan", () => {
  it("keeps rich-only and mixed-mode rich stacks aligned outside explicit deltas", () => {
    const richOnly = getCoflatRichPluginPlan({
      editable: true,
      hasClipboardPlugin: true,
      hasHistoryPlugin: false,
      hasOnChange: true,
      hasSelectionPlugin: true,
      showBibliography: true,
      showBlockKeyboardAccess: true,
      showCodeBlockChrome: true,
      showHeadingChrome: true,
      showInteractionTrace: true,
      showListMarkerStrip: true,
      showMarkdownExpansion: true,
      showReferenceTypeahead: true,
      showSlashPicker: true,
      showSourcePosition: true,
      showTableChrome: true,
      showTabKey: true,
      showViewportTracking: true,
    });
    const mixedModeRich = getCoflatRichPluginPlan({
      editable: true,
      hasClipboardPlugin: false,
      hasHistoryPlugin: true,
      hasOnChange: true,
      hasSelectionPlugin: true,
      showBibliography: true,
      showBlockKeyboardAccess: true,
      showCodeBlockChrome: true,
      showHeadingChrome: true,
      showInteractionTrace: true,
      showListMarkerStrip: true,
      showMarkdownExpansion: true,
      showReferenceTypeahead: true,
      showSlashPicker: true,
      showSourcePosition: true,
      showTableChrome: false,
      showTabKey: true,
      showViewportTracking: true,
    });

    expect(withoutEditorDeltas(richOnly)).toEqual(withoutEditorDeltas(mixedModeRich));
    expect(richOnly).toContain("clipboard");
    expect(richOnly).toContain("table-scroll-shadow");
    expect(richOnly).toContain("table-action-menu");
    expect(mixedModeRich).not.toContain("clipboard");
    expect(mixedModeRich).not.toContain("table-scroll-shadow");
    expect(mixedModeRich).not.toContain("table-action-menu");
  });

  it("omits edit-only plugins for read-only rich surfaces", () => {
    const readOnly = getCoflatRichPluginPlan({
      editable: false,
      hasClipboardPlugin: false,
      hasHistoryPlugin: false,
      hasOnChange: true,
      hasSelectionPlugin: false,
      showBibliography: false,
      showBlockKeyboardAccess: true,
      showCodeBlockChrome: true,
      showHeadingChrome: true,
      showInteractionTrace: true,
      showListMarkerStrip: true,
      showMarkdownExpansion: true,
      showReferenceTypeahead: true,
      showSlashPicker: true,
      showSourcePosition: true,
      showTableChrome: true,
      showTabKey: true,
      showViewportTracking: true,
    });

    expect(readOnly).toEqual([
      "rich-text",
      "code-highlight",
      "code-fence-exit",
      "code-block-chrome",
      "list",
      "check-list",
      "link",
      "table-scroll-shadow",
      "heading-chrome-index",
      "source-position",
      "viewport-tracking",
      "interaction-trace",
      "active-editor",
      "tree-view",
    ]);
  });
});
