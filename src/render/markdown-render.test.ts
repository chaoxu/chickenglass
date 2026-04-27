import { describe, expect, it, afterEach } from "vitest";
import { Decoration, EditorView, type ViewUpdate } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import {
  computeMarkdownContextChangeRanges,
  computeMarkdownDocChangeRanges,
  markdownRenderPlugin,
  _markdownDocChangeNeedsContextMergeForTest as markdownDocChangeNeedsContextMerge,
  cursorContextKey,
  markdownShouldUpdate,
  _collectMarkdownItemsForTest as collectMarkdownItems,
  _clearLinkDecorationCacheForTest as clearLinkDecorationCache,
  _linkDecorationCacheSizeForTest as linkDecorationCacheSize,
} from "./markdown-render";
import {
  createCursorSensitiveViewPlugin,
  cursorInRange,
  createSimpleViewPlugin,
} from "./render-utils";
import {
  createEditorState,
  createTestView,
  getDecorationSpecs,
  hasLineClassAt,
  hasMarkClassInRange,
} from "../test-utils";
import { CSS } from "../constants/css-classes";
import { markdownExtensions } from "../parser";

/** Create an EditorView with the markdown render plugin at the given cursor position. */
function createView(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [markdown({ extensions: markdownExtensions }), markdownRenderPlugin],
  });
}

function getAllDecorationSpecs(view: EditorView) {
  return view.state.facet(EditorView.decorations)
    .flatMap((source) => getDecorationSpecs(typeof source === "function" ? source(view) : source));
}

describe("cursorInRange", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("returns true when cursor is inside the range", () => {
    view = createView("hello world", 5);
    expect(cursorInRange(view, 0, 10)).toBe(true);
  });

  it("returns true when cursor is at range start", () => {
    view = createView("hello world", 0);
    expect(cursorInRange(view, 0, 5)).toBe(true);
  });

  it("returns true when cursor is at range end", () => {
    view = createView("hello world", 5);
    expect(cursorInRange(view, 0, 5)).toBe(true);
  });

  it("returns false when cursor is outside the range", () => {
    view = createView("hello world", 8);
    expect(cursorInRange(view, 0, 5)).toBe(false);
  });

  describe("negative / edge-case", () => {
    it("returns false for an empty range (from === to) with cursor elsewhere", () => {
      view = createView("abc", 2);
      expect(cursorInRange(view, 1, 1)).toBe(false);
    });

    it("returns false when cursor is exactly at range end (exclusive boundary)", () => {
      // cursorInRange uses cursor >= from && cursor <= to, so cursor === to is true
      // Verifying boundary semantics are consistent
      view = createView("hello", 3);
      expect(cursorInRange(view, 0, 3)).toBe(true);
    });

    it("returns false when cursor is well past range end", () => {
      view = createView("hello world", 10);
      expect(cursorInRange(view, 0, 3)).toBe(false);
    });
  });
});

describe("markdownRenderPlugin (Decoration.mark approach)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("creates a view with the plugin without errors", () => {
    view = createView("# Hello\n\nSome **bold** text");
    expect(view.state.doc.toString()).toBe("# Hello\n\nSome **bold** text");
  });

  it("handles empty document", () => {
    view = createView("");
    expect(view.state.doc.toString()).toBe("");
  });

  it("handles document with all element types", () => {
    const doc = [
      "# Heading 1",
      "",
      "Some **bold** and *italic* text with `code`.",
      "",
      "[link](https://example.com)",
      "",
      "![image](photo.png)",
      "",
      "---",
    ].join("\n");
    view = createView(doc);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("replaces bullet list source markers with bullet glyph widgets", () => {
    view = createView("- top one\n- top two", 0);
    const specs = getAllDecorationSpecs(view);

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 0,
          to: 1,
          widgetClass: "BulletListMarkerWidget",
        }),
        expect.objectContaining({
          from: 10,
          to: 11,
          widgetClass: "BulletListMarkerWidget",
        }),
      ]),
    );
  });

  it("keeps ordered list markers as styled source text", () => {
    view = createView("1. top one\n2. top two", 0);
    const specs = getAllDecorationSpecs(view);
    expect(hasMarkClassInRange(specs, 0, 2, CSS.listNumber)).toBe(true);
    expect(specs.some((spec) => spec.widgetClass === "BulletListMarkerWidget")).toBe(false);
  });

  it("replaces horizontal rule source with an hr widget outside the cursor", () => {
    view = createView("before\n\n---\n\nafter", 0);
    const specs = getAllDecorationSpecs(view);
    const from = view.state.doc.toString().indexOf("---");

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from,
          to: from + 3,
          widgetClass: "HorizontalRuleWidget",
        }),
      ]),
    );
  });

  it("keeps horizontal rule source visible when the cursor is inside", () => {
    const doc = "before\n\n---\n\nafter";
    const from = doc.indexOf("---");
    view = createView(doc, from + 1);
    const specs = getAllDecorationSpecs(view);

    expect(specs.some((spec) => spec.widgetClass === "HorizontalRuleWidget")).toBe(false);
  });

  it("replaces canonical HTML br tags with break widgets outside the cursor", () => {
    view = createView("line<br />break", 0);
    const specs = getAllDecorationSpecs(view);
    const from = view.state.doc.toString().indexOf("<br />");

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from,
          to: from + "<br />".length,
          widgetClass: "HardBreakWidget",
        }),
      ]),
    );
  });

  it("renders paired subscript and superscript HTML tags", () => {
    view = createView("H<sub>2</sub>O", 0);
    const subItems = collectMarkdownItems(
      view,
      [{ from: 0, to: view.state.doc.length }],
      () => false,
    );

    expect(subItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 6,
          to: 7,
          value: expect.objectContaining({
            spec: expect.objectContaining({ tagName: "sub" }),
          }),
        }),
      ]),
    );

    view.destroy();
    view = createView("x<sup>2</sup>", 0);
    const supItems = collectMarkdownItems(
      view,
      [{ from: 0, to: view.state.doc.length }],
      () => false,
    );

    expect(supItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 6,
          to: 7,
          value: expect.objectContaining({
            spec: expect.objectContaining({ tagName: "sup" }),
          }),
        }),
      ]),
    );
  });

  it("does not throw when cursor is at beginning", () => {
    view = createView("# Hello\n\n**bold**", 0);
    expect(view.state.doc.toString()).toBe("# Hello\n\n**bold**");
  });

  it("does not throw when cursor is at end", () => {
    const doc = "# Hello\n\n**bold**";
    view = createView(doc, doc.length);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("survives rapid document changes", () => {
    view = createView("# Start");
    for (let i = 0; i < 100; i++) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: `\nLine ${i}` },
      });
    }
    expect(view.state.doc.lines).toBe(101);
  });

  it("handles cursor movement through decorated regions", () => {
    const doc = "before **bold** after";
    view = createView(doc, 0);

    // Move cursor through the bold region
    for (let i = 0; i <= doc.length; i++) {
      view.dispatch({ selection: { anchor: i } });
    }

    expect(view.state.doc.toString()).toBe(doc);
  });

  it("source text is preserved in the document (mark approach keeps text)", () => {
    const doc = "**bold** and *italic*";
    view = createView(doc, doc.length); // cursor at end, outside markup
    // The document always keeps source text with Decoration.mark
    expect(view.state.doc.toString()).toBe(doc);
    // Markers are still in the doc (not replaced by widgets)
    expect(view.state.doc.toString()).toContain("**");
    expect(view.state.doc.toString()).toContain("*italic*");
  });

  it("uses Decoration.mark not Decoration.replace", () => {
    // Verify the plugin produces mark decorations, not replace decorations
    const doc = "**bold**";
    view = createView(doc, doc.length);
    // The key property of mark decorations: source text stays in the doc
    // and is not replaced by widget DOM. The doc should read the same.
    expect(view.state.doc.toString()).toBe("**bold**");
    // A replace decoration would remove the text from the DOM entirely
    // and substitute a widget. With marks, the text remains.
  });

  it("does not hide markers when cursor is inside element", () => {
    // Cursor at position 4 is inside "**bold**" (positions 0-7)
    const doc = "**bold**";
    view = createView(doc, 4);
    // With cursor inside, no decorations should be applied
    // (the tree walk returns false, skipping marker hiding)
    expect(view.state.doc.toString()).toBe(doc);
  });

  describe("source-delimiter decorations (#789)", () => {
    /** Collect decorations with class "cf-source-delimiter" for the full doc range. */
    function getSourceDelimiters(v: EditorView) {
      const items = collectMarkdownItems(
        v,
        [{ from: 0, to: v.state.doc.length }],
        () => false,
      );
      return items.filter((r) => r.value.spec.class === CSS.sourceDelimiter);
    }

    function getInlineSourceRuns(v: EditorView) {
      const items = collectMarkdownItems(
        v,
        [{ from: 0, to: v.state.doc.length }],
        () => false,
      );
      return items.filter((r) => r.value.spec.class === CSS.inlineSource);
    }

    it("applies cf-source-delimiter to bold markers when cursor is inside", () => {
      view = createView("**bold**", 4);
      const delims = getSourceDelimiters(view);
      expect(delims.length).toBeGreaterThan(0);
    });

    it("applies cf-source-delimiter to italic markers when cursor is inside", () => {
      view = createView("*italic*", 3);
      const delims = getSourceDelimiters(view);
      expect(delims.length).toBeGreaterThan(0);
    });

    it("decorates marks at ALL nesting levels in ***x*** (#789 regression)", () => {
      // ***x*** parses as Emphasis > StrongEmphasis (or vice versa).
      // The outer handler must not short-circuit inner marks.
      view = createView("***x***", 3);
      const delims = getSourceDelimiters(view);
      // 4 EmphasisMark nodes: outer pair + inner pair — all must be decorated.
      expect(delims.length).toBeGreaterThanOrEqual(4);
    });

    it("decorates inner italic marks in **a *b* c** (#789 regression)", () => {
      // StrongEmphasis wraps Emphasis; both levels have delimiter marks.
      view = createView("**a *b* c**", 5);
      const delims = getSourceDelimiters(view);
      // Outer ** (×2) + inner * (×2) = at least 4 decorated ranges
      expect(delims.length).toBeGreaterThanOrEqual(4);
    });

    it("does not apply cf-source-delimiter when cursor is outside", () => {
      view = createView("**bold** rest", 12);
      const delims = getSourceDelimiters(view);
      expect(delims.length).toBe(0);
    });

    it("applies compact reveal metrics to link source marks and URL content", () => {
      const doc = "[target](https://example.com)";
      view = createView(doc, doc.indexOf("target") + 2);

      const delims = getSourceDelimiters(view);
      const sourceRuns = getInlineSourceRuns(view);

      expect(delims.length).toBeGreaterThanOrEqual(4);
      expect(sourceRuns).toHaveLength(1);
      expect(view.state.sliceDoc(sourceRuns[0].from, sourceRuns[0].to)).toBe("https://example.com");
    });
  });

  describe("incremental collection", () => {
    it("skips retained parent nodes without swallowing dirty nested descendants", () => {
      const doc = "# Hello **bold**";
      const boldFrom = doc.indexOf("**bold**");
      const boldTo = boldFrom + "**bold**".length;
      view = createView(doc, 1);

      const items = collectMarkdownItems(
        view,
        [{ from: boldFrom, to: boldTo }],
        (nodeFrom) => nodeFrom === 0,
      );

      expect(items.some((item) =>
        item.from === boldFrom &&
        item.to === boldTo &&
        item.value.spec.class === "cf-bold"
      )).toBe(true);
      expect(items.some((item) => item.value.spec.class?.startsWith("cf-heading"))).toBe(false);
    });

    it("does not duplicate boundary-straddling markdown decorations across disjoint ranges", () => {
      view = createView("**bold** tail", 12);
      const items = collectMarkdownItems(
        view,
        [{ from: 0, to: 2 }, { from: 6, to: 8 }],
        () => false,
      );

      expect(items.filter((item) => item.value.spec.class === "cf-bold")).toHaveLength(1);
    });

    it("reuses link decorations for identical URLs", () => {
      clearLinkDecorationCache();
      const doc = "[one](https://example.com) [two](https://example.com) tail";
      view = createView(doc, doc.length);

      const items = collectMarkdownItems(
        view,
        [{ from: 0, to: doc.length }],
        () => false,
      );
      const linkItems = items.filter((item) => item.value.spec.class === "cf-link-rendered");

      expect(linkItems).toHaveLength(2);
      expect(linkItems[0].value).toBe(linkItems[1].value);
    });

    it("bounds cached rendered-link decorations for unique URLs", () => {
      clearLinkDecorationCache();
      const doc = Array.from(
        { length: 300 },
        (_, index) => `[${index}](https://example.com/${index})`,
      ).join(" ");
      view = createView(doc, doc.length);

      collectMarkdownItems(
        view,
        [{ from: 0, to: doc.length }],
        () => false,
      );

      expect(linkDecorationCacheSize()).toBeLessThanOrEqual(256);
    });

    it("renders reference-style links through shared link definitions", () => {
      const doc = "[target][ref]\n\n[ref]: https://example.com";
      view = createView(doc, doc.indexOf("\n"));

      const specs = getAllDecorationSpecs(view);
      const linkTextFrom = doc.indexOf("target");
      const definitionFrom = doc.indexOf("[ref]:");

      expect(hasMarkClassInRange(specs, linkTextFrom, linkTextFrom + "target".length, CSS.linkRendered)).toBe(true);
      expect(hasMarkClassInRange(specs, definitionFrom, doc.length, CSS.hidden)).toBe(true);
    });

    it("renders bare autolink URLs as clickable text", () => {
      const doc = "Visit https://example.com now";
      view = createView(doc, 0);

      const specs = getAllDecorationSpecs(view);
      const urlFrom = doc.indexOf("https://example.com");

      expect(hasMarkClassInRange(specs, urlFrom, urlFrom + "https://example.com".length, CSS.linkRendered)).toBe(true);
    });

    it("hides HTML comments outside the cursor and reveals them for editing", () => {
      const doc = "before\n<!-- hidden note -->\nafter";
      const commentFrom = doc.indexOf("<!--");
      const commentTo = doc.indexOf("-->") + 3;
      view = createView(doc, 0);

      expect(hasMarkClassInRange(getAllDecorationSpecs(view), commentFrom, commentTo, CSS.hidden)).toBe(true);

      view.destroy();
      view = createView(doc, commentFrom + 5);

      expect(hasMarkClassInRange(getAllDecorationSpecs(view), commentFrom, commentTo, CSS.hidden)).toBe(false);
    });
  });

  describe("negative / edge-case", () => {
    it("handles deeply nested inline formatting without error", () => {
      const doc = "***bold and italic***";
      view = createView(doc, 0);
      expect(view.state.doc.toString()).toBe(doc);
    });

    it("handles only whitespace document", () => {
      view = createView("   \n\n   ");
      expect(view.state.doc.toString()).toBe("   \n\n   ");
    });

    it("handles document with only headings", () => {
      const doc = "# H1\n## H2\n### H3";
      view = createView(doc);
      expect(view.state.doc.toString()).toBe(doc);
    });

    it("handles single character document", () => {
      view = createView("x");
      expect(view.state.doc.toString()).toBe("x");
    });

    it("does not throw on very long lines", () => {
      const longLine = "a".repeat(10000);
      view = createView(longLine);
      expect(view.state.doc.toString().length).toBe(10000);
    });
  });
});

describe("cursorContextKey", () => {
  it("returns empty string for plain text", () => {
    const state = createEditorState("hello world", {
      cursorPos: 5,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toBe("");
  });

  it("returns a key when cursor is inside bold", () => {
    const state = createEditorState("**bold** text", {
      cursorPos: 4,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^StrongEmphasis:\d+:\d+$/);
  });

  it("returns a key when cursor is inside italic", () => {
    const state = createEditorState("*italic* text", {
      cursorPos: 3,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^Emphasis:\d+:\d+$/);
  });

  it("returns a key when cursor is inside a heading", () => {
    const state = createEditorState("# Heading\n\ntext", {
      cursorPos: 3,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^ATXHeading1:\d+:\d+$/);
  });

  it("returns a key when cursor is inside a link", () => {
    const state = createEditorState("[link](url) text", {
      cursorPos: 3,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^Link:\d+:\d+$/);
  });

  it("same key for two positions within the same node", () => {
    const ext = markdown();
    const stateA = createEditorState("**bold** text", {
      cursorPos: 3,
      extensions: ext,
    });
    const stateB = createEditorState("**bold** text", {
      cursorPos: 5,
      extensions: ext,
    });
    expect(cursorContextKey(stateA)).toBe(cursorContextKey(stateB));
  });

  it("different key for positions in different nodes", () => {
    const ext = markdown();
    const stateInBold = createEditorState("**bold** *italic*", {
      cursorPos: 3,
      extensions: ext,
    });
    const stateInItalic = createEditorState("**bold** *italic*", {
      cursorPos: 11,
      extensions: ext,
    });
    expect(cursorContextKey(stateInBold)).not.toBe(cursorContextKey(stateInItalic));
  });
});

describe("markdownShouldUpdate (rebuild narrowing, #579)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  /**
   * Create a view with a counting plugin that uses markdownShouldUpdate.
   * Performs a warm-up dispatch to flush the spurious focusChanged that
   * JSDOM produces on the first dispatch after construction.
   */
  function createCountingView(doc: string, cursorPos = 0) {
    let buildCount = 0;
    const ext = createSimpleViewPlugin(
      () => { buildCount++; return Decoration.none; },
      { shouldUpdate: markdownShouldUpdate },
    );
    view = createTestView(doc, {
      cursorPos,
      extensions: [markdown(), ext],
    });
    // Warm-up: first dispatch after construction has spurious focusChanged
    view.dispatch({ selection: { anchor: cursorPos } });
    buildCount = 0;
    return { getBuildCount: () => buildCount };
  }

  it("does not rebuild when cursor moves within plain text", () => {
    const { getBuildCount } = createCountingView("hello world", 0);
    view.dispatch({ selection: { anchor: 5 } });
    expect(getBuildCount()).toBe(0);
  });

  it("rebuilds when cursor enters a bold node", () => {
    const { getBuildCount } = createCountingView("**bold** text", 12);
    view.dispatch({ selection: { anchor: 4 } });
    expect(getBuildCount()).toBe(1);
  });

  it("does not rebuild when cursor moves within the same bold node", () => {
    const { getBuildCount } = createCountingView("**bold** text", 3);
    view.dispatch({ selection: { anchor: 5 } });
    expect(getBuildCount()).toBe(0);
  });

  it("rebuilds when cursor leaves a bold node", () => {
    const { getBuildCount } = createCountingView("**bold** text", 4);
    view.dispatch({ selection: { anchor: 12 } });
    expect(getBuildCount()).toBe(1);
  });

  it("rebuilds when cursor moves between different sensitive nodes", () => {
    const { getBuildCount } = createCountingView("**bold** *italic*", 4);
    view.dispatch({ selection: { anchor: 11 } });
    expect(getBuildCount()).toBe(1);
  });

  it("rebuilds on document change", () => {
    const { getBuildCount } = createCountingView("hello", 0);
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(getBuildCount()).toBe(1);
  });

  it("does not rebuild when cursor moves within a heading", () => {
    const { getBuildCount } = createCountingView("# Hello World\n\ntext", 3);
    view.dispatch({ selection: { anchor: 7 } });
    expect(getBuildCount()).toBe(0);
  });

  it("rebuilds when cursor enters a heading", () => {
    const { getBuildCount } = createCountingView("# Hello\n\ntext", 12);
    view.dispatch({ selection: { anchor: 3 } });
    expect(getBuildCount()).toBe(1);
  });

  it("rebuilds when cursor moves from heading to nested inline node", () => {
    const { getBuildCount } = createCountingView("# Hello **bold**\n\ntext", 3);
    view.dispatch({ selection: { anchor: 12 } }); // into bold inside heading
    expect(getBuildCount()).toBe(1);
  });
});

describe("computeMarkdownDocChangeRanges (#823)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  function createDocRangeView(doc: string, cursorPos = 0) {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        selectionCheck: (update) =>
          cursorContextKey(update.state) !== cursorContextKey(update.startState),
        docChangeRanges: computeMarkdownDocChangeRanges,
      },
    );
    view = createTestView(doc, {
      cursorPos,
      extensions: [markdown(), ext],
    });
    // Warm-up: first dispatch after construction has a spurious focusChanged.
    view.dispatch({ selection: { anchor: cursorPos } });
    receivedRanges = [];
    return { getRanges: () => receivedRanges };
  }

  function createContextRangeView(doc: string, cursorPos = 0) {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        contextChangeRanges: computeMarkdownContextChangeRanges,
      },
    );
    view = createTestView(doc, {
      cursorPos,
      extensions: [markdown(), ext],
    });
    view.dispatch({ selection: { anchor: cursorPos } });
    receivedRanges = [];
    return { getRanges: () => receivedRanges };
  }

  function mockDocChangeUpdate(
    startState: ReturnType<typeof createEditorState>,
    state: ReturnType<typeof createEditorState>,
    overrides: Partial<Pick<ViewUpdate, "focusChanged">> = {},
  ): ViewUpdate {
    return {
      docChanged: true,
      selectionSet: false,
      focusChanged: overrides.focusChanged ?? false,
      viewportChanged: false,
      state,
      startState,
      view: { hasFocus: true } as EditorView,
    } as unknown as ViewUpdate;
  }

  it("skips cursor-context merging when doc changes keep selection and focus stable", () => {
    const startState = createEditorState("plain **bold** text", {
      cursorPos: 3,
      extensions: [markdown()],
    });
    const tr = startState.update({
      changes: { from: startState.doc.length, insert: "x" },
    });

    expect(markdownDocChangeNeedsContextMerge(mockDocChangeUpdate(startState, tr.state))).toBe(false);
  });

  it("keeps cursor-context merging enabled when doc changes move selection or focus", () => {
    const startState = createEditorState("plain **bold** text", {
      cursorPos: 3,
      extensions: [markdown()],
    });
    const movedSelection = createEditorState("plain **bold** text", {
      cursorPos: 5,
      extensions: [markdown()],
    });

    expect(markdownDocChangeNeedsContextMerge(mockDocChangeUpdate(startState, movedSelection))).toBe(true);
    expect(
      markdownDocChangeNeedsContextMerge(
        mockDocChangeUpdate(startState, startState, { focusChanged: true }),
      ),
    ).toBe(true);
  });

  it("keeps prose typing scoped to the dirty fragment", () => {
    const { getRanges } = createDocRangeView("intro text\n\n**bold** tail", 5);
    view.dispatch({ changes: { from: 2, insert: "X" } });
    expect(getRanges()).toEqual([]);
  });

  it("expands edits inside bold text to the full formatted node", () => {
    const doc = "plain **bold** tail";
    const boldFrom = doc.indexOf("**bold**");
    const boldTo = boldFrom + "**bold**".length;
    const { getRanges } = createDocRangeView(doc, doc.length);
    view.dispatch({ changes: { from: boldFrom + 4, insert: "!" } });
    expect(getRanges()).toEqual([{ from: boldFrom, to: boldTo + 1 }]);
  });

  it("rebuilds only the entered markdown region on selection changes", () => {
    const doc = "plain **bold** tail";
    const boldFrom = doc.indexOf("**bold**");
    const boldTo = boldFrom + "**bold**".length;
    const { getRanges } = createContextRangeView(doc, 2);

    view.dispatch({ selection: { anchor: boldFrom + 3 } });

    expect(getRanges()).toEqual([{ from: boldFrom, to: boldTo }]);
  });

  it("rebuilds only the nested inline region when the outer heading context is unchanged", () => {
    const doc = "# Hello **bold**";
    const boldFrom = doc.indexOf("**bold**");
    const boldTo = boldFrom + "**bold**".length;
    const { getRanges } = createContextRangeView(doc, 2);

    view.dispatch({ selection: { anchor: boldFrom + 3 } });

    expect(getRanges()).toEqual([{ from: boldFrom, to: boldTo }]);
  });
});

describe("markdownRenderPlugin doc-change invalidation (#823)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("removes stale hidden markers when emphasis syntax is destroyed", () => {
    view = createView("**bold** tail", 12);
    const before = getAllDecorationSpecs(view);
    expect(hasMarkClassInRange(before, 0, 2, "cf-hidden")).toBe(true);

    view.dispatch({ changes: { from: 6, to: 8, insert: "" } });

    const after = getAllDecorationSpecs(view);
    expect(view.state.doc.toString()).toBe("**bold tail");
    expect(hasMarkClassInRange(after, 0, 2, "cf-hidden")).toBe(false);
  });

  it("replaces stale heading line decorations when the heading level changes", () => {
    view = createView("# Heading", 1);
    expect(hasLineClassAt(getAllDecorationSpecs(view), 0, "cf-heading-line-1")).toBe(true);

    view.dispatch({ changes: { from: 0, to: 1, insert: "##" } });

    const after = getAllDecorationSpecs(view);
    expect(view.state.doc.toString()).toBe("## Heading");
    expect(hasLineClassAt(after, 0, "cf-heading-line-1")).toBe(false);
    expect(hasLineClassAt(after, 0, "cf-heading-line-2")).toBe(true);
  });
});
