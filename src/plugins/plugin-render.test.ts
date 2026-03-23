/**
 * Unit tests for blockDecorationField — tests decoration logic
 * without a browser by creating EditorState directly.
 *
 * Pattern: EditorState.create({doc, extensions}) → state.field(blockDecorationField)
 * to check which decorations are applied for a given document + cursor position.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import {
  _blockDecorationFieldForTest as blockDecorationField,
  embedSandboxPermissions,
} from "./plugin-render";
import { createPluginRegistryField } from "./plugin-registry";
import { blockCounterField } from "./block-counter";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { editorFocusField, focusEffect } from "../render/render-utils";
import { mathMacrosField } from "../render/math-macros";
import { frontmatterField } from "../editor/frontmatter-state";
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

  it("shows source when cursor is on opening fence (focused)", () => {
    const theoremStart = 0;
    const state = createTestState(TWO_BLOCKS, theoremStart, true);
    const specs = getDecoSpecs(state);

    // Opening fence: cf-block-source is a MARK decoration on syntax only, not a line class.
    // The line should NOT have cf-block-source as a line class (that made the whole line monospace).
    const theoremLine = state.doc.line(1);
    expect(hasLineClassAt(specs, theoremLine.from, CSS.blockSource)).toBe(false);
    expect(hasLineClassAt(specs, theoremLine.from, CSS.blockHeader)).toBe(false);
    // But cf-block-source mark should cover the fence syntax range
    expect(hasMarkClassInRange(specs, theoremLine.from, theoremLine.to, CSS.blockSource)).toBe(true);

    // No header widget for theorem (source mode)
    // But proof should still have its header widget
    const proofLine = state.doc.line(5).from;
    expect(hasLineClassAt(specs, proofLine, CSS.blockHeader)).toBe(true);
  });

  it("hides closing fence when cursor is not on it", () => {
    // Cursor on line 2 (content, not fence)
    const contentPos = TWO_BLOCKS.indexOf("Content");
    const state = createTestState(TWO_BLOCKS, contentPos, true);
    const specs = getDecoSpecs(state);

    // Closing fence line (:::) should have cf-include-fence (collapsed)
    const closeFenceLine = state.doc.line(3).from;
    expect(hasLineClassAt(specs, closeFenceLine, CSS.includeFence)).toBe(true);
  });

  it("shows closing fence source when cursor is on closing fence", () => {
    const closeFencePos = TWO_BLOCKS.indexOf(":::\n\n::: {.proof}");
    const state = createTestState(TWO_BLOCKS, closeFencePos, true);
    const specs = getDecoSpecs(state);

    // Closing fence should have cf-block-source (visible)
    const closeFenceLine = state.doc.line(3).from;
    expect(hasLineClassAt(specs, closeFenceLine, CSS.blockSource)).toBe(true);
    expect(hasLineClassAt(specs, closeFenceLine, CSS.includeFence)).toBe(false);
  });

  it("shows both fences when cursor is on opening fence", () => {
    const state = createTestState(TWO_BLOCKS, 0, true);
    const specs = getDecoSpecs(state);

    // Opening: cf-block-source as mark decoration on syntax portion only
    const openLine = state.doc.line(1);
    expect(hasMarkClassInRange(specs, openLine.from, openLine.to, CSS.blockSource)).toBe(true);
    expect(hasLineClassAt(specs, openLine.from, CSS.blockSource)).toBe(false);

    // Closing: cf-block-source as line decoration (no title content to protect)
    const closeFenceLine = state.doc.line(3).from;
    expect(hasLineClassAt(specs, closeFenceLine, CSS.blockSource)).toBe(true);
    expect(hasLineClassAt(specs, closeFenceLine, CSS.includeFence)).toBe(false);
  });

  it("other blocks unaffected when cursor is on one block's fence", () => {
    // Cursor on theorem opening fence
    const state = createTestState(TWO_BLOCKS, 0, true);
    const specs = getDecoSpecs(state);

    // Proof block should be fully rendered (not in source mode)
    const proofOpenLine = state.doc.line(5).from;
    expect(hasLineClassAt(specs, proofOpenLine, CSS.blockHeader)).toBe(true);
    expect(hasLineClassAt(specs, proofOpenLine, CSS.blockSource)).toBe(false);

    // Proof closing fence should be hidden
    const proofCloseLine = state.doc.line(7).from;
    expect(hasLineClassAt(specs, proofCloseLine, CSS.includeFence)).toBe(true);
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

  it("title paren widgets present in rendered mode, absent in source mode (REGRESSION)", () => {
    const doc = `::: {.theorem} Main Result\nContent\n:::`;

    // Rendered mode (unfocused — cursor not on fence)
    const rendered = createTestState(doc);
    const renderedSpecs = getDecoSpecs(rendered);
    const renderedParens = renderedSpecs.filter((s) => s.widgetClass === "SimpleTextWidget");
    expect(renderedParens.length).toBe(2); // ( and )

    // Source mode (cursor on opening fence)
    const source = createTestState(doc, 0, true);
    const sourceSpecs = getDecoSpecs(source);
    const sourceParens = sourceSpecs.filter((s) => s.widgetClass === "SimpleTextWidget");
    expect(sourceParens.length).toBe(0); // no parens in source mode
  });

  it("cf-block-source mark covers only fence syntax, not title text (#278)", () => {
    const doc = `::: {.theorem} Main Result\nContent\n:::`;
    const state = createTestState(doc, 0, true);
    const specs = getDecoSpecs(state);

    const line1 = state.doc.line(1);
    const titleText = "Main Result";
    const titleFrom = line1.text.indexOf(titleText) + line1.from;
    const titleTo = titleFrom + titleText.length;

    // cf-block-source mark should cover fence syntax (before title)
    expect(hasMarkClassInRange(specs, line1.from, titleFrom, CSS.blockSource)).toBe(true);

    // cf-block-source mark must NOT cover the title text range
    const sourceMarksOnTitle = specs.filter(
      (s) =>
        s.from !== s.to && // mark decoration
        s.from < titleTo &&
        s.to > titleFrom &&
        s.class?.includes(CSS.blockSource),
    );
    expect(sourceMarksOnTitle.length).toBe(0);
  });

  it("no-title block: cf-block-source mark covers entire fence syntax (#278)", () => {
    const doc = `::: {.proof}\nContent\n:::`;
    const state = createTestState(doc, 0, true);
    const specs = getDecoSpecs(state);

    const line1 = state.doc.line(1);
    // Entire opening fence is syntax — mark should cover it
    expect(hasMarkClassInRange(specs, line1.from, line1.to, CSS.blockSource)).toBe(true);
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
});

describe("embedSandboxPermissions", () => {
  it("never grants allow-same-origin to embed iframes", () => {
    expect(embedSandboxPermissions("embed")).toBe("allow-scripts");
    expect(embedSandboxPermissions("iframe")).toBe("allow-scripts");
    expect(embedSandboxPermissions("gist")).toBe("allow-scripts");
    expect(embedSandboxPermissions("youtube")).toBe("allow-scripts allow-presentation");
  });
});
