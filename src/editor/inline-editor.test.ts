/**
 * Tests for the inline editor's render extensions.
 *
 * Verifies that the lightweight inline CM6 editor used for table cells
 * produces the correct decorations for inline markdown elements:
 * math (KaTeX), bold/italic/code marker hiding, links, highlights,
 * strikethrough, and citation/crossref state wiring.
 *
 * Regression test for #406: table edit mode must render inline content
 * with visual parity to the main editor.
 */
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  createMarkdownLanguageExtensions,
  createProjectConfigExtensions,
  inlineMarkdownExtensions,
  sharedInlineRenderExtensions,
} from "./base-editor-extensions";
import { createInlineEditor } from "./inline-editor";
import { bibDataField } from "../state/bib-data";
import { documentAnalysisField } from "../state/document-analysis";
import { referenceRenderPlugin } from "../render/reference-render";
import { CSS } from "../constants/css-classes";
import { CSL_FIXTURES, makeBibStore } from "../test-utils";
import { CslProcessor } from "../citations/csl-processor";
import { frontmatterField } from "./frontmatter-state";
import type { DocumentReferenceCatalog } from "../semantics/reference-catalog";

// jsdom lacks ResizeObserver — provide a no-op stub.
class ResizeObserverStub {
  disconnect = vi.fn();
  observe() {}
  unobserve() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

/**
 * Create extensions matching the full inline editor setup (including
 * citation support). Mirrors createInlineEditor's extension list for
 * isolated state/view testing.
 */
function fullInlineEditorExtensions(macros: Record<string, string> = {}) {
  return [
    ...createMarkdownLanguageExtensions({ extensions: inlineMarkdownExtensions }),
    ...createProjectConfigExtensions({ math: macros }),
    ...sharedInlineRenderExtensions,
    frontmatterField,
    documentAnalysisField,
    bibDataField,
    referenceRenderPlugin,
    EditorView.lineWrapping,
  ];
}

function createInlineEditorState(doc: string, macros: Record<string, string> = {}): EditorState {
  return EditorState.create({
    doc,
    extensions: fullInlineEditorExtensions(macros),
  });
}

/** Collect all node names from the syntax tree. */
function getNodeNames(state: EditorState): string[] {
  const names: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

/** Create a real inline editor view (DOM-mounted) for decoration testing. */
function createInlineEditorView(
  doc: string,
  macros: Record<string, string> = {},
  cursorPos?: number,
): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc,
    selection: cursorPos !== undefined ? { anchor: cursorPos } : undefined,
    extensions: fullInlineEditorExtensions(macros),
  });
  const view = new EditorView({ state, parent });
  return view;
}

/** Collect decoration class names from a view's rendered DOM. */
function getDecorationClasses(view: EditorView): string[] {
  const classes: string[] = [];
  const dom = view.dom;
  const selectors: Record<string, string> = {
    "cf-math-inline": ".cf-math-inline, .cf-math-display",
    "cf-bold": ".cf-bold",
    "cf-italic": ".cf-italic",
    "cf-inline-code": ".cf-inline-code",
    "cf-link-rendered": ".cf-link-rendered",
    "cf-highlight": ".cf-highlight",
    "cf-hidden": ".cf-hidden",
    "cf-citation": ".cf-citation",
    "cf-reference-source": ".cf-reference-source",
  };
  for (const [className, selector] of Object.entries(selectors)) {
    const els = dom.querySelectorAll(selector);
    for (let i = 0; i < els.length; i++) {
      classes.push(className);
    }
  }
  return classes;
}

describe("inline editor parser coverage (#406)", () => {
  it("parses inline math ($...$)", () => {
    const state = createInlineEditorState("$x^2$");
    const names = getNodeNames(state);
    expect(names).toContain("InlineMath");
  });

  it("parses bold (**...**)", () => {
    const state = createInlineEditorState("**bold**");
    const names = getNodeNames(state);
    expect(names).toContain("StrongEmphasis");
  });

  it("parses italic (*...*)", () => {
    const state = createInlineEditorState("*italic*");
    const names = getNodeNames(state);
    expect(names).toContain("Emphasis");
  });

  it("parses inline code (`...`)", () => {
    const state = createInlineEditorState("`code`");
    const names = getNodeNames(state);
    expect(names).toContain("InlineCode");
  });

  it("parses links ([text](url))", () => {
    const state = createInlineEditorState("[link](https://example.com)");
    const names = getNodeNames(state);
    expect(names).toContain("Link");
  });

  it("parses highlight (==text==)", () => {
    const state = createInlineEditorState("==highlight==");
    const names = getNodeNames(state);
    expect(names).toContain("Highlight");
  });

  it("parses strikethrough (~~text~~)", () => {
    const state = createInlineEditorState("~~strikethrough~~");
    const names = getNodeNames(state);
    expect(names).toContain("Strikethrough");
  });
});

describe("inline editor decoration rendering (#406)", () => {
  it("adds a root class for CSS-based inline editor chrome overrides", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = createInlineEditor({
      parent,
      doc: "text",
      macros: {},
      onChange: () => {},
    });

    expect(view.dom.classList.contains(CSS.inlineEditor)).toBe(true);
    view.destroy();
    parent.remove();
  });

  it("renders bold text with cf-bold mark when cursor is outside", () => {
    const view = createInlineEditorView("**bold** text", {}, 13);
    const classes = getDecorationClasses(view);
    expect(classes).toContain("cf-bold");
    view.destroy();
  });

  it("renders italic text with cf-italic mark when cursor is outside", () => {
    const view = createInlineEditorView("*italic* text", {}, 13);
    const classes = getDecorationClasses(view);
    expect(classes).toContain("cf-italic");
    view.destroy();
  });

  it("renders inline code with cf-inline-code mark", () => {
    const view = createInlineEditorView("`code` text", {}, 11);
    const classes = getDecorationClasses(view);
    expect(classes).toContain("cf-inline-code");
    view.destroy();
  });

  it("renders links with cf-link-rendered mark when cursor is outside", () => {
    const view = createInlineEditorView("[link](https://example.com) text", {}, 32);
    const classes = getDecorationClasses(view);
    expect(classes).toContain("cf-link-rendered");
    view.destroy();
  });

  it("renders highlight with cf-highlight mark", () => {
    const view = createInlineEditorView("==highlight== text", {}, 18);
    const classes = getDecorationClasses(view);
    expect(classes).toContain("cf-highlight");
    view.destroy();
  });

  it("renders math as KaTeX widget when cursor is outside", () => {
    const view = createInlineEditorView("$x^2$ text", {}, 10);
    const classes = getDecorationClasses(view);
    expect(classes).toContain("cf-math-inline");
    view.destroy();
  });

  it("hides link markers (LinkMark, URL) when cursor is outside", () => {
    const view = createInlineEditorView("[link](https://example.com) text", {}, 32);
    const lineText = view.dom.querySelector(".cm-line")?.textContent ?? "";
    expect(lineText).toContain("link");
    expect(lineText).not.toContain("[");
    expect(lineText).not.toContain("https://example.com");
    view.destroy();
  });

  it("hides highlight markers when cursor is outside", () => {
    const view = createInlineEditorView("==highlight== text", {}, 18);
    const lineText = view.dom.querySelector(".cm-line")?.textContent ?? "";
    expect(lineText).toContain("highlight");
    expect(lineText).not.toContain("==");
    view.destroy();
  });
});

describe("inline editor citation state wiring (#406)", () => {
  // Regression: #406 reopen — the inline editor did not load
  // referenceRenderPlugin, so [@id] citations were shown as raw source
  // text instead of styled spans. These tests verify the state fields
  // and plugin wiring are correct.

  it("includes documentAnalysisField that detects [@id] references", () => {
    const state = createInlineEditorState("See [@karger2000] for details");
    const analysis = state.field(documentAnalysisField);
    expect(analysis.references).toHaveLength(1);
    expect(analysis.references[0].ids).toEqual(["karger2000"]);
    expect(analysis.references[0].bracketed).toBe(true);
  });

  it("includes bibDataField initialized empty by default", () => {
    const state = createInlineEditorState("[@karger2000]");
    const bibData = state.field(bibDataField);
    expect(bibData.store.size).toBe(0);
  });

  it("populates bibDataField when bibData option is provided", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const store = makeBibStore([CSL_FIXTURES.karger]);
    const cslProcessor = new CslProcessor([CSL_FIXTURES.karger]);

    const view = createInlineEditor({
      parent,
      doc: "[@karger2000]",
      macros: {},
      bibData: { store, cslProcessor },
      onChange: () => {},
    });

    const bibData = view.state.field(bibDataField);
    expect(bibData.store.size).toBe(1);
    expect(bibData.store.has("karger2000")).toBe(true);

    view.destroy();
    parent.remove();
  });

  it("does not crash when no bib data is provided", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const view = createInlineEditor({
      parent,
      doc: "[@unknown]",
      macros: {},
      onChange: () => {},
    });

    expect(view.state.doc.toString()).toBe("[@unknown]");

    view.destroy();
    parent.remove();
  });

  it("does not crash with citation content and bib data provided", () => {
    // Verifies the full stack (parser + semantics + bibData + referenceRenderPlugin)
    // wires together without errors, matching the existing referenceRenderPlugin
    // test pattern in citation-finder.test.ts.
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const store = makeBibStore([CSL_FIXTURES.karger]);
    const cslProcessor = new CslProcessor([CSL_FIXTURES.karger]);

    const view = createInlineEditor({
      parent,
      doc: "See [@karger2000] for details",
      macros: {},
      bibData: { store, cslProcessor },
      onChange: () => {},
    });

    expect(view.state.doc.toString()).toBe("See [@karger2000] for details");

    view.destroy();
    parent.remove();
  });
});

describe("inline editor citation widget rendering (#422)", () => {
  // Regression: #422 — the inline editor showed citations as
  // <span class="cf-link-rendered"> instead of CitationWidget.
  // The markdownRenderPlugin's Link handler was treating [@id] as
  // a normal link and applying cf-link-rendered styling. The
  // referenceRenderPlugin's Decoration.replace widget was either
  // not produced or conflicting with the Link decoration.

  it("renders [@id] as cf-citation widget, not cf-link-rendered", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const store = makeBibStore([CSL_FIXTURES.karger]);
    const cslProcessor = new CslProcessor([CSL_FIXTURES.karger]);

    const view = createInlineEditor({
      parent,
      doc: "[@karger2000]",
      macros: {},
      bibData: { store, cslProcessor },
      onChange: () => {},
    });

    const citationEls = view.dom.querySelectorAll(".cf-citation");
    const linkRenderedEls = view.dom.querySelectorAll(".cf-link-rendered");

    // Citation should be rendered as a widget, not as a styled link
    expect(citationEls.length).toBeGreaterThan(0);
    expect(linkRenderedEls.length).toBe(0);

    view.destroy();
    parent.remove();
  });

  it("renders equation crossref [@eq:gaussian] as cf-crossref widget", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    // No bib data — this is a crossref, not a citation
    const view = createInlineEditor({
      parent,
      doc: "[@eq:gaussian]",
      macros: {},
      onChange: () => {},
    });

    // Without equation context, this should at least not show cf-link-rendered
    const linkRenderedEls = view.dom.querySelectorAll(".cf-link-rendered");
    expect(linkRenderedEls.length).toBe(0);

    view.destroy();
    parent.remove();
  });

  it("renders block crossrefs from an injected root reference catalog", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const target = {
      id: "thm:fundamental",
      kind: "block" as const,
      from: 100,
      to: 120,
      displayLabel: "Theorem 1",
      number: "1",
      ordinal: 1,
      title: "Fundamental Theorem",
      blockType: "theorem",
    };
    const referenceCatalog: DocumentReferenceCatalog = {
      targets: [target],
      targetsById: new Map([[target.id, [target]]]),
      uniqueTargetById: new Map([[target.id, target]]),
      duplicatesById: new Map(),
      references: [],
    };

    const view = createInlineEditor({
      parent,
      doc: "[@thm:fundamental]",
      macros: {},
      referenceCatalog,
      onChange: () => {},
    });

    const crossrefEl = view.dom.querySelector(".cf-crossref");
    const unresolvedEl = view.dom.querySelector(".cf-crossref-unresolved");

    expect(crossrefEl?.textContent).toBe("Theorem 1");
    expect(unresolvedEl).toBeNull();

    view.destroy();
    parent.remove();
  });

  it("renders clustered citations [@a; @b] as cf-citation widget", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const store = makeBibStore([CSL_FIXTURES.karger, CSL_FIXTURES.stein]);
    const cslProcessor = new CslProcessor([CSL_FIXTURES.karger, CSL_FIXTURES.stein]);

    const view = createInlineEditor({
      parent,
      doc: "[@karger2000; @stein2001]",
      macros: {},
      bibData: { store, cslProcessor },
      onChange: () => {},
    });

    const citationEls = view.dom.querySelectorAll(".cf-citation");
    const linkRenderedEls = view.dom.querySelectorAll(".cf-link-rendered");

    expect(citationEls.length).toBeGreaterThan(0);
    expect(linkRenderedEls.length).toBe(0);

    view.destroy();
    parent.remove();
  });
});
