/**
 * Unit tests for blockDecorationField — tests decoration logic
 * without a browser by creating EditorState directly.
 *
 * Pattern: EditorState.create({doc, extensions}) → state.field(blockDecorationField)
 * to check which decorations are applied for a given document + cursor position.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import {
  _blockDecorationFieldForTest as blockDecorationField,
  _BlockCaptionWidgetForTest as BlockCaptionWidget,
  _BlockHeaderWidgetForTest as BlockHeaderWidget,
  embedSandboxPermissions,
} from "./plugin-render";
import { createPluginRegistryField } from "./plugin-registry";
import { blockCounterField } from "./block-counter";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { editorFocusField, focusEffect, mathMacrosField } from "../render/render-core";
import { widgetSourceMap } from "../render/render-utils";
import { frontmatterField } from "../editor/frontmatter-state";
import {
  activeStructureEditField,
  createFencedStructureEditTarget,
  setStructureEditTargetEffect,
} from "../editor/structure-edit-state";
import { defaultPlugins } from "./default-plugins";
import { IFRAME_POLL_INTERVAL_MS } from "../constants/timing";
import {
  applyStateEffects,
  createEditorState,
  getDecorationSpecs,
  hasLineClassAt,
  hasMarkClassInRange,
  makeBlockPlugin,
} from "../test-utils";
import { CSS } from "../constants/css-classes";

/** Create an EditorState with all extensions needed for block decorations. */
function createTestState(doc: string, cursorPos = 0, focused = false) {
  const state = createEditorState(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      mathMacrosField,
      createPluginRegistryField([]),
      blockCounterField,
      editorFocusField,
      blockDecorationField,
    ],
  });

  return focused ? applyStateEffects(state, focusEffect.of(true)) : state;
}

/**
 * Create an EditorState pre-loaded with the given plugins, where frontmatter
 * in the doc can disable specific ones via `blocks: { name: false }`.
 *
 * The pluginRegistryField reads frontmatter on create, so disabling via
 * frontmatter is the canonical integration path tested here.
 */
function createTestStateWithPlugins(
  doc: string,
  plugins: ReturnType<typeof makeBlockPlugin>[],
  cursorPos = 0,
  focused = false,
) {
  const state = createEditorState(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      mathMacrosField,
      createPluginRegistryField(plugins),
      blockCounterField,
      editorFocusField,
      blockDecorationField,
    ],
  });

  return focused ? applyStateEffects(state, focusEffect.of(true)) : state;
}

function getDecoSpecs(state: EditorState) {
  return getDecorationSpecs(state.field(blockDecorationField));
}

function getWidgetFromDecorations<T>(state: EditorState, widgetClass: string): T {
  const cursor = state.field(blockDecorationField).iter();
  while (cursor.value) {
    const widget = cursor.value.spec.widget;
    if (widget?.constructor?.name === widgetClass) {
      return widget as T;
    }
    cursor.next();
  }
  throw new Error(`expected widget ${widgetClass}`);
}

afterEach(() => {
  vi.useRealTimers();
});

const TWO_BLOCKS = [
  "::: {.theorem} Title",
  "Content",
  ":::",
  "",
  "::: {.proof}",
  "Proof text",
  ":::",
].join("\n");

describe("blockDecorationField", () => {
  it("renders header widget when cursor is not on fence (unfocused)", () => {
    const state = createTestState(TWO_BLOCKS);
    const specs = getDecoSpecs(state);

    // Should have decorations for both blocks
    expect(specs.length).toBeGreaterThan(0);

    // Opening fence lines should have cf-block-header class
    const theoremLine = state.doc.line(1).from;
    expect(hasLineClassAt(specs, theoremLine, CSS.blockHeader)).toBe(true);

    // Should have BlockHeaderWidget replacements
    const widgets = specs.filter((s) => s.widgetClass === "BlockHeaderWidget");
    expect(widgets.length).toBe(2); // theorem + proof
  });

  it("keeps the rendered shell when cursor is on opening fence until structure edit activates", () => {
    const theoremStart = 0;
    const state = createTestState(TWO_BLOCKS, theoremStart, true);
    const specs = getDecoSpecs(state);

    const theoremLine = state.doc.line(1);
    expect(hasLineClassAt(specs, theoremLine.from, CSS.blockSource)).toBe(false);
    expect(hasLineClassAt(specs, theoremLine.from, CSS.blockHeader)).toBe(true);
    expect(hasMarkClassInRange(specs, theoremLine.from, theoremLine.to, CSS.blockSource)).toBe(false);
  });

  it("shows opener source when structure edit is active for a block", () => {
    const base = createTestState(TWO_BLOCKS, 0, true);
    const active = applyStateEffects(
      base,
      setStructureEditTargetEffect.of(createFencedStructureEditTarget(base, 0)),
    );
    const specs = getDecoSpecs(active);

    const theoremLine = active.doc.line(1);
    // cf-block-header stays on the line class for geometry stability (#1015).
    // Widget replacement also stays active — structure editing uses explicit
    // mapped state, not raw-text editing of fence syntax.
    expect(hasLineClassAt(specs, theoremLine.from, CSS.blockHeader)).toBe(true);

    const proofLine = active.doc.line(5).from;
    expect(hasLineClassAt(specs, proofLine, CSS.blockHeader)).toBe(true);
  });

  it("hides closing fence when cursor is not on it", () => {
    // Cursor on line 2 (content, not fence)
    const contentPos = TWO_BLOCKS.indexOf("Content");
    const state = createTestState(TWO_BLOCKS, contentPos, true);
    const specs = getDecoSpecs(state);

    // Closing fence line (:::) should have cf-block-closing-fence (collapsed)
    const closeFenceLine = state.doc.line(3).from;
    expect(hasLineClassAt(specs, closeFenceLine, CSS.blockClosingFence)).toBe(true);
  });

  it("closing fence always hidden even when cursor is on closing fence (#428)", () => {
    // Closing fence is always hidden in rich mode — cursor position doesn't matter
    const closeFencePos = TWO_BLOCKS.indexOf(":::\n\n::: {.proof}");
    const state = createTestState(TWO_BLOCKS, closeFencePos, true);
    const specs = getDecoSpecs(state);

    // Closing fence should be hidden (cf-block-closing-fence), NOT source-visible
    const closeFenceLine = state.doc.line(3).from;
    expect(hasLineClassAt(specs, closeFenceLine, CSS.blockClosingFence)).toBe(true);
    expect(hasLineClassAt(specs, closeFenceLine, CSS.blockSource)).toBe(false);
  });

  it("closing fence stays hidden when structure edit is active on the opener (#428)", () => {
    const base = createTestState(TWO_BLOCKS, 0, true);
    const state = applyStateEffects(
      base,
      setStructureEditTargetEffect.of(createFencedStructureEditTarget(base, 0)),
    );
    const specs = getDecoSpecs(state);

    // Opening: widget replacement stays active for geometry stability (#1015)
    const openLine = state.doc.line(1);
    expect(hasLineClassAt(specs, openLine.from, CSS.blockHeader)).toBe(true);
    expect(hasLineClassAt(specs, openLine.from, CSS.blockSource)).toBe(false);

    // Closing fence is always hidden — cf-block-closing-fence, not cf-block-source
    const closeFenceLine = state.doc.line(3).from;
    expect(hasLineClassAt(specs, closeFenceLine, CSS.blockClosingFence)).toBe(true);
    expect(hasLineClassAt(specs, closeFenceLine, CSS.blockSource)).toBe(false);
  });

  it("other blocks stay rendered when one block has active structure edit", () => {
    const base = createTestState(TWO_BLOCKS, 0, true);
    const state = applyStateEffects(
      base,
      setStructureEditTargetEffect.of(createFencedStructureEditTarget(base, 0)),
    );
    const specs = getDecoSpecs(state);

    // Proof block should be fully rendered (not in source mode)
    const proofOpenLine = state.doc.line(5).from;
    expect(hasLineClassAt(specs, proofOpenLine, CSS.blockHeader)).toBe(true);
    expect(hasLineClassAt(specs, proofOpenLine, CSS.blockSource)).toBe(false);

    // Proof closing fence should be hidden with cf-block-closing-fence
    const proofCloseLine = state.doc.line(7).from;
    expect(hasLineClassAt(specs, proofCloseLine, CSS.blockClosingFence)).toBe(true);
  });

  it("header widget replaces only fence prefix, not title text", () => {
    const doc = `::: {.theorem} **Main Result**\nContent\n:::`;
    const state = createTestState(doc);
    const specs = getDecoSpecs(state);

    // Widget should replace only the fence prefix, not the title text
    const widgets = specs.filter((s) => s.widgetClass === "BlockHeaderWidget");
    expect(widgets.length).toBe(1);

    const line1 = state.doc.line(1);
    // Replace range should start at line start but NOT extend to end of line
    expect(widgets[0].from).toBe(line1.from);
    expect(widgets[0].to).toBeLessThan(line1.to);
  });

  /**
   * REGRESSION GUARD — Block header rendering must behave like headings.
   *
   * The widget MUST replace only the fence prefix ("::: {.class}"), leaving
   * the title text as editable document content. This ensures:
   * 1. Inline plugins render math/bold/italic in the title (Lezer parses them)
   * 2. Cursor-aware toggling works (only source when cursor touches inline element)
   * 3. Title parens are added via Decoration.widget (not CSS ::before/::after
   *    which breaks when Decoration.replace splits the mark around math widgets)
   *
   * This has regressed 3+ times. See CLAUDE.md "Block headers must behave like headings."
   */
  it("title text NOT inside widget — inline plugins can render it (REGRESSION)", () => {
    const doc = `::: {.theorem} Fundamental Theorem $x^2$\nContent\n:::`;
    const state = createTestState(doc);
    const specs = getDecoSpecs(state);

    const line1 = state.doc.line(1);
    const widgets = specs.filter((s) => s.widgetClass === "BlockHeaderWidget");
    expect(widgets.length).toBe(1);

    // Widget must NOT extend to end of line (title text is outside widget)
    expect(widgets[0].to).toBeLessThan(line1.to);

    // Title text ($x^2$) range must not be covered by any replace decoration
    const titleText = "Fundamental Theorem $x^2$";
    const titleFrom = line1.text.indexOf(titleText) + line1.from;
    const titleTo = titleFrom + titleText.length;
    const replaceSpecs = specs.filter(
      (s) => s.widgetClass && s.from < titleTo && s.to > titleFrom,
    );
    // Only the header widget should exist, and it must end before the title
    for (const r of replaceSpecs) {
      expect(r.to).toBeLessThanOrEqual(titleFrom);
    }
  });

  it("title paren widgets are hidden only during explicit structure edit (REGRESSION)", () => {
    const doc = `::: {.theorem} Main Result\nContent\n:::`;

    const rendered = createTestState(doc);
    const renderedSpecs = getDecoSpecs(rendered);
    const renderedParens = renderedSpecs.filter((s) => s.widgetClass === "SimpleTextWidget");
    expect(renderedParens.length).toBe(2); // ( and )

    const base = createTestState(doc, 0, true);
    const source = applyStateEffects(
      base,
      setStructureEditTargetEffect.of(createFencedStructureEditTarget(base, 0)),
    );
    const sourceSpecs = getDecoSpecs(source);
    const sourceParens = sourceSpecs.filter((s) => s.widgetClass === "SimpleTextWidget");
    expect(sourceParens.length).toBe(0);
  });

  it("structure edit keeps widget replacement for geometry stability (#1015)", () => {
    const doc = `::: {.theorem} Main Result\nContent\n:::`;
    const base = createTestState(doc, 0, true);
    const state = applyStateEffects(
      base,
      setStructureEditTargetEffect.of(createFencedStructureEditTarget(base, 0)),
    );
    const specs = getDecoSpecs(state);

    const line1 = state.doc.line(1);
    // Widget replacement stays active — no cf-block-source mark on the line
    expect(hasMarkClassInRange(specs, line1.from, line1.to, CSS.blockSource)).toBe(false);
    // Header class present for geometry stability
    expect(hasLineClassAt(specs, line1.from, CSS.blockHeader)).toBe(true);
  });

  it("no-title block: structure edit keeps widget replacement (#1015)", () => {
    const doc = `::: {.proof}\nContent\n:::`;
    const base = createTestState(doc, 0, true);
    const state = applyStateEffects(
      base,
      setStructureEditTargetEffect.of(createFencedStructureEditTarget(base, 0)),
    );
    const specs = getDecoSpecs(state);

    const line1 = state.doc.line(1);
    // Widget replacement stays active — no source mark
    expect(hasMarkClassInRange(specs, line1.from, line1.to, CSS.blockSource)).toBe(false);
  });

  it("does not crash on an incomplete fenced div without a closing fence", () => {
    const doc = [
      "::: {.definition}",
      "Body",
    ].join("\n");

    expect(() => {
      const state = createTestState(doc, 0, true);
      getDecoSpecs(state);
    }).not.toThrow();
  });

  it("renders attribute-only title via widget when no inline title (issue #401)", () => {
    // title="**3SUM**" in attributes, no inline title text after attributes
    const doc = `::: {.theorem title="**3SUM**"}\nContent\n:::`;
    const state = createTestState(doc);
    const specs = getDecoSpecs(state);

    // Should have a BlockHeaderWidget for the label
    const headerWidgets = specs.filter((s) => s.widgetClass === "BlockHeaderWidget");
    expect(headerWidgets.length).toBe(1);

    // Should have an AttributeTitleWidget for the attribute-only title
    const attrTitleWidgets = specs.filter((s) => s.widgetClass === "AttributeTitleWidget");
    expect(attrTitleWidgets.length).toBe(1);

    // No inline title paren widgets (those are only for inline titles)
    const parenWidgets = specs.filter((s) => s.widgetClass === "SimpleTextWidget");
    expect(parenWidgets.length).toBe(0);
  });

  it("attribute-only title widget is hidden only during explicit structure edit", () => {
    const doc = `::: {.theorem title="**3SUM**"}\nContent\n:::`;
    const base = createTestState(doc, 0, true);
    const state = applyStateEffects(
      base,
      setStructureEditTargetEffect.of(createFencedStructureEditTarget(base, 0)),
    );
    const specs = getDecoSpecs(state);

    // In source mode: no attribute title widget, no header widget
    const attrTitleWidgets = specs.filter((s) => s.widgetClass === "AttributeTitleWidget");
    expect(attrTitleWidgets.length).toBe(0);
  });

  it("inline title takes precedence over attribute title (issue #401)", () => {
    // Both inline title and attribute title present — inline wins
    const doc = `::: {.theorem title="Attr Title"} Inline Title\nContent\n:::`;
    const state = createTestState(doc);
    const specs = getDecoSpecs(state);

    // Should have inline title paren widgets (for the inline title text)
    const parenWidgets = specs.filter((s) => s.widgetClass === "SimpleTextWidget");
    expect(parenWidgets.length).toBe(2);

    // Should NOT have an AttributeTitleWidget (inline title takes precedence)
    const attrTitleWidgets = specs.filter((s) => s.widgetClass === "AttributeTitleWidget");
    expect(attrTitleWidgets.length).toBe(0);
  });

  it("no title widget when neither inline nor attribute title exists", () => {
    const doc = `::: {.proof}\nContent\n:::`;
    const state = createTestState(doc);
    const specs = getDecoSpecs(state);

    // No attribute title widget
    const attrTitleWidgets = specs.filter((s) => s.widgetClass === "AttributeTitleWidget");
    expect(attrTitleWidgets.length).toBe(0);

    // No paren widgets
    const parenWidgets = specs.filter((s) => s.widgetClass === "SimpleTextWidget");
    expect(parenWidgets.length).toBe(0);
  });
});

describe("disabled blocks show raw fences (issue #356)", () => {
  it("disabled block via frontmatter shows no cf-block-header (raw fences)", () => {
    // blocks: { theorem: false } must make the fenced div render as raw text,
    // not as a styled block. No cf-block-header, no header widget.
    const doc = [
      "---",
      "blocks:",
      "  theorem: false",
      "---",
      "::: {.theorem} Main Result",
      "Content",
      ":::",
    ].join("\n");

    const state = createTestStateWithPlugins(
      doc,
      [makeBlockPlugin({ name: "theorem", title: "Theorem" })],
    );
    const specs = getDecoSpecs(state);

    // The theorem block's opening line must NOT have cf-block-header
    const theoremLine = state.doc.line(5).from; // line 5 after 4-line frontmatter
    expect(hasLineClassAt(specs, theoremLine, CSS.blockHeader)).toBe(false);

    // No header widget should be emitted for a disabled block
    const widgets = specs.filter((s) => s.widgetClass === "BlockHeaderWidget");
    expect(widgets).toHaveLength(0);
  });

  it("enabled block alongside disabled block renders correctly", () => {
    // When theorem is disabled and proof is not, proof should still render.
    const doc = [
      "---",
      "blocks:",
      "  theorem: false",
      "---",
      "::: {.theorem}",
      "A theorem.",
      ":::",
      "",
      "::: {.proof}",
      "A proof.",
      ":::",
    ].join("\n");

    const state = createTestStateWithPlugins(
      doc,
      [
        makeBlockPlugin({ name: "theorem", title: "Theorem" }),
        makeBlockPlugin({ name: "proof", numbered: false, title: "Proof" }),
      ],
    );
    const specs = getDecoSpecs(state);

    // theorem line: no cf-block-header
    const theoremLine = state.doc.line(5).from;
    expect(hasLineClassAt(specs, theoremLine, CSS.blockHeader)).toBe(false);

    // proof line: has cf-block-header (not disabled)
    const proofLine = state.doc.line(9).from;
    expect(hasLineClassAt(specs, proofLine, CSS.blockHeader)).toBe(true);
  });

  it("renders proof label inline on the first body line", () => {
    const doc = `::: {.proof}\nProof text\n:::`;
    const state = createTestStateWithPlugins(
      doc,
      [makeBlockPlugin({ name: "proof", numbered: false, title: "Proof", headerPosition: "inline" })],
    );
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.blockHeaderCollapsed)).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.blockHeader)).toBe(true);

    const widgets = specs.filter((s) => s.widgetClass === "BlockHeaderWidget");
    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.from).toBe(state.doc.line(2).from);
  });

  it("keeps embed previews mounted when the cursor enters the block body", () => {
    const doc = `::: {.embed}\nhttps://example.com/widget\n:::`;
    const state = createTestStateWithPlugins(
      doc,
      [makeBlockPlugin({ name: "embed", specialBehavior: "embed" })],
      doc.indexOf("https://example.com/widget"),
      true,
    );
    const specs = getDecoSpecs(state);

    const widgets = specs.filter((s) => s.widgetClass === "EmbedWidget");
    expect(widgets).toHaveLength(1);
    expect(hasMarkClassInRange(specs, state.doc.line(1).from, state.doc.line(1).to, CSS.blockSource)).toBe(false);
  });

  it("shows embed source only during explicit structure edit", () => {
    const doc = `::: {.embed}\nhttps://example.com/widget\n:::`;
    const base = createTestStateWithPlugins(
      doc,
      [makeBlockPlugin({ name: "embed", specialBehavior: "embed" })],
      doc.indexOf("https://example.com/widget"),
      true,
    );
    const state = applyStateEffects(
      base,
      setStructureEditTargetEffect.of(createFencedStructureEditTarget(base, 0)),
    );
    const specs = getDecoSpecs(state);

    const widgets = specs.filter((s) => s.widgetClass === "EmbedWidget");
    expect(widgets).toHaveLength(0);
    // Widget replacement stays active for geometry stability (#1015)
    expect(hasMarkClassInRange(specs, state.doc.line(1).from, state.doc.line(1).to, CSS.blockSource)).toBe(false);
  });

  it("routes inline proof labels back to the hidden opener source", () => {
    const doc = `::: {.proof}\nProof text\n:::`;
    const state = createTestStateWithPlugins(
      doc,
      [makeBlockPlugin({ name: "proof", numbered: false, title: "Proof", headerPosition: "inline" })],
    );

    const widget = getWidgetFromDecorations<BlockHeaderWidget>(state, "BlockHeaderWidget");
    const openerLine = state.doc.line(1);

    expect(widget.sourceFrom).toBe(openerLine.from);
    expect(widget.sourceTo).toBe(openerLine.to);
  });

  it("renders figure captions as below-content widgets", () => {
    const doc = `::: {.figure} Caption text\n![alt](img.png)\n:::`;
    const state = createTestStateWithPlugins(
      doc,
      [makeBlockPlugin({ name: "figure", numbered: true, title: "Figure", captionPosition: "below" })],
    );
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.blockHeaderCollapsed)).toBe(true);
    const captionWidgets = specs.filter((s) => s.widgetClass === "BlockCaptionWidget");
    expect(captionWidgets).toHaveLength(1);
  });

  it("targets the hidden opening-line caption text for below-caption widgets", () => {
    const doc = `::: {.figure} Caption text\n![alt](img.png)\n:::`;
    const state = createTestStateWithPlugins(
      doc,
      [makeBlockPlugin({ name: "figure", numbered: true, title: "Figure", captionPosition: "below" })],
    );

    const widget = getWidgetFromDecorations<BlockCaptionWidget>(state, "BlockCaptionWidget");
    const openLine = state.doc.line(1);
    const titleText = "Caption text";
    const titleFrom = openLine.text.indexOf(titleText) + openLine.from;
    const titleTo = titleFrom + titleText.length;

    expect(widget.sourceFrom).toBe(titleFrom);
    expect(widget.sourceTo).toBe(titleTo);
  });

  it("falls back to the opening fence when a below-caption block has no caption text", () => {
    const doc = `::: {.figure}\n![alt](img.png)\n:::`;
    const state = createTestStateWithPlugins(
      doc,
      [makeBlockPlugin({ name: "figure", numbered: true, title: "Figure", captionPosition: "below" })],
    );

    const widget = getWidgetFromDecorations<BlockCaptionWidget>(state, "BlockCaptionWidget");
    const openLine = state.doc.line(1);

    expect(widget.sourceFrom).toBe(openLine.from);
    expect(widget.sourceTo).toBe(openLine.to);
  });
});

describe("BlockHeaderWidget.updateDOM", () => {
  it("updates content and refreshes source-range metadata", () => {
    const oldWidget = new BlockHeaderWidget("Theorem 1.", {});
    oldWidget.sourceFrom = 0;
    oldWidget.sourceTo = 15;
    const dom = oldWidget.toDOM();

    expect(widgetSourceMap.get(dom)).toBe(oldWidget);
    expect(dom.dataset.sourceFrom).toBe("0");
    expect(dom.dataset.sourceTo).toBe("15");

    const newWidget = new BlockHeaderWidget("Theorem 2.", {});
    newWidget.sourceFrom = 22;
    newWidget.sourceTo = 37;

    const result = newWidget.updateDOM(dom);
    expect(result).toBe(true);

    // Source-range metadata must be refreshed (reviewer #732 blocking issue)
    const mappedWidget = widgetSourceMap.get(dom);
    expect(mappedWidget).toBe(newWidget);
    expect(mappedWidget?.sourceFrom).toBe(22);
    expect(mappedWidget?.sourceTo).toBe(37);
    expect(dom.dataset.sourceFrom).toBe("22");
    expect(dom.dataset.sourceTo).toBe("37");
  });

  it("preserves DOM node identity (no destroy/recreate)", () => {
    const oldWidget = new BlockHeaderWidget("Proof.", {});
    oldWidget.sourceFrom = 0;
    oldWidget.sourceTo = 10;
    const dom = oldWidget.toDOM();
    const domRef = dom;

    const newWidget = new BlockHeaderWidget("Lemma 1.", {});
    newWidget.sourceFrom = 0;
    newWidget.sourceTo = 10;
    newWidget.updateDOM(dom);

    expect(dom).toBe(domRef);
  });
});

describe("BlockCaptionWidget.updateDOM", () => {
  it("updates content and refreshes source-range metadata", () => {
    const oldWidget = new BlockCaptionWidget("Figure 1.", "Old caption", {});
    oldWidget.sourceFrom = 10;
    oldWidget.sourceTo = 21;
    const dom = oldWidget.toDOM();

    expect(widgetSourceMap.get(dom)).toBe(oldWidget);
    expect(dom.dataset.sourceFrom).toBe("10");
    expect(dom.dataset.sourceTo).toBe("21");

    const newWidget = new BlockCaptionWidget("Figure 2.", "New caption", {});
    newWidget.sourceFrom = 30;
    newWidget.sourceTo = 41;

    const result = newWidget.updateDOM(dom);
    expect(result).toBe(true);

    expect(dom.textContent).toContain("Figure 2.");
    expect(dom.textContent).toContain("New caption");
    const mappedWidget = widgetSourceMap.get(dom);
    expect(mappedWidget).toBe(newWidget);
    expect(mappedWidget?.sourceFrom).toBe(30);
    expect(mappedWidget?.sourceTo).toBe(41);
    expect(dom.dataset.sourceFrom).toBe("30");
    expect(dom.dataset.sourceTo).toBe("41");
  });
});

describe("EmbedWidget cleanup", () => {
  function createEmbedState(doc: string): EditorState {
    return createEditorState(doc, {
      extensions: [
        markdown({ extensions: markdownExtensions }),
        frontmatterField,
        documentSemanticsField,
        mathMacrosField,
        createPluginRegistryField(defaultPlugins),
        blockCounterField,
        editorFocusField,
        blockDecorationField,
      ],
    });
  }

  it("removes the gist load handler when the widget is destroyed before load", () => {
    vi.useFakeTimers();

    const state = createEmbedState("::: {.gist}\nhttps://gist.github.com/user/abc123\n:::");
    const widget = getWidgetFromDecorations<{
      toDOM(): HTMLElement;
      destroy(dom: HTMLElement): void;
    }>(state, "EmbedWidget");
    const dom = widget.toDOM();
    const iframe = dom.querySelector<HTMLIFrameElement>("iframe");
    expect(iframe).not.toBeNull();
    if (!iframe) {
      throw new Error("expected gist iframe");
    }

    let contentDocumentReads = 0;
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get() {
        contentDocumentReads++;
        return { body: null } as unknown as Document;
      },
    });

    widget.destroy(dom);
    iframe.dispatchEvent(new Event("load"));
    vi.runOnlyPendingTimers();

    expect(contentDocumentReads).toBe(0);
  });

  it("cancels gist resize polling when the widget is destroyed", () => {
    vi.useFakeTimers();

    const state = createEmbedState("::: {.gist}\nhttps://gist.github.com/user/abc123\n:::");
    const widget = getWidgetFromDecorations<{
      toDOM(): HTMLElement;
      destroy(dom: HTMLElement): void;
    }>(state, "EmbedWidget");
    const dom = widget.toDOM();
    const iframe = dom.querySelector<HTMLIFrameElement>("iframe");
    expect(iframe).not.toBeNull();
    if (!iframe) {
      throw new Error("expected gist iframe");
    }

    let contentDocumentReads = 0;
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get() {
        contentDocumentReads++;
        return { body: null } as unknown as Document;
      },
    });

    iframe.dispatchEvent(new Event("load"));
    expect(contentDocumentReads).toBe(1);

    vi.advanceTimersByTime(IFRAME_POLL_INTERVAL_MS);
    expect(contentDocumentReads).toBe(2);

    widget.destroy(dom);
    vi.advanceTimersByTime(IFRAME_POLL_INTERVAL_MS * 4);

    expect(contentDocumentReads).toBe(2);
  });
});

describe("embedSandboxPermissions", () => {
  it("never grants allow-same-origin to embed iframes", () => {
    expect(embedSandboxPermissions("embed")).toBe("allow-scripts");
    expect(embedSandboxPermissions("iframe")).toBe("allow-scripts");
    expect(embedSandboxPermissions("gist")).toBe("allow-scripts");
    expect(embedSandboxPermissions("youtube")).toBe("allow-scripts allow-presentation");
  });
});
