import { describe, expect, it } from "vitest";

import {
  type CoflatRichPluginId,
  type CoflatRichPluginPlanOptions,
  getCoflatRichPluginPlan,
} from "./lexical-composer-shell";

const richMarkdownWrapperDeltas = new Set<CoflatRichPluginId>([
  "clipboard",
  "history",
  "table-scroll-shadow",
  "table-action-menu",
]);

function withoutRichMarkdownWrapperDeltas(
  plan: readonly CoflatRichPluginId[],
): readonly CoflatRichPluginId[] {
  return plan.filter((pluginId) => !richMarkdownWrapperDeltas.has(pluginId));
}

function richMarkdownEditorWrapperOptions(): CoflatRichPluginPlanOptions {
  return {
    editable: true,
    hasClipboardPlugin: true,
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
    showTableChrome: true,
    showTabKey: true,
    showViewportTracking: true,
  };
}

function markdownEditorRichWrapperOptions(): CoflatRichPluginPlanOptions {
  return {
    editable: true,
    hasClipboardPlugin: false,
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
    showTableChrome: false,
    showTabKey: true,
    showViewportTracking: true,
  };
}

describe("coflat rich composer plugin plan", () => {
  it("keeps both rich wrapper stacks aligned outside explicit wrapper deltas", () => {
    const richMarkdownEditor = getCoflatRichPluginPlan(
      richMarkdownEditorWrapperOptions(),
    );
    const markdownEditorRichMode = getCoflatRichPluginPlan(
      markdownEditorRichWrapperOptions(),
    );

    expect(withoutRichMarkdownWrapperDeltas(richMarkdownEditor)).toEqual(
      withoutRichMarkdownWrapperDeltas(markdownEditorRichMode),
    );
    expect(richMarkdownEditor).toEqual([
      "clipboard",
      "rich-text",
      "code-highlight",
      "code-fence-exit",
      "code-block-chrome",
      "history",
      "list",
      "check-list",
      "list-marker-strip",
      "link",
      "table-scroll-shadow",
      "table-action-menu",
      "format-event",
      "markdown-expansion",
      "block-keyboard-access",
      "tab-key",
      "reference-typeahead",
      "slash-picker",
      "heading-chrome-index",
      "source-position",
      "viewport-tracking",
      "markdown-shortcuts",
      "on-change",
      "selection",
      "interaction-trace",
      "bibliography",
      "active-editor",
      "tree-view",
    ]);
    expect(markdownEditorRichMode).toEqual([
      "rich-text",
      "code-highlight",
      "code-fence-exit",
      "code-block-chrome",
      "list",
      "check-list",
      "list-marker-strip",
      "link",
      "format-event",
      "markdown-expansion",
      "block-keyboard-access",
      "tab-key",
      "reference-typeahead",
      "slash-picker",
      "heading-chrome-index",
      "source-position",
      "viewport-tracking",
      "markdown-shortcuts",
      "on-change",
      "selection",
      "interaction-trace",
      "bibliography",
      "active-editor",
      "tree-view",
    ]);
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
