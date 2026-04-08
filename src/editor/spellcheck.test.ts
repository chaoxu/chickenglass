import { afterEach, describe, expect, it } from "vitest";
import {
  type DecorationSet,
  EditorView,
  type ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { createMarkdownLanguageExtensions } from "./base-editor-extensions";
import {
  _spellcheckMarkViewPluginForTest,
  spellcheckEnabledField,
  spellcheckExtension,
  toggleSpellcheck,
} from "./spellcheck";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { createTestView } from "../test-utils";

interface SpellcheckPluginValue {
  decorations: DecorationSet;
  update(update: ViewUpdate): void;
}

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function createSpellcheckView(doc: string, cursorPos = 0): EditorView {
  view = createTestView(doc, {
    cursorPos,
    extensions: [
      ...createMarkdownLanguageExtensions(),
      documentAnalysisField,
      spellcheckExtension,
    ],
  });
  return view;
}

function getSpellcheckPlugin(v: EditorView): SpellcheckPluginValue {
  const plugin = v.plugin(
    _spellcheckMarkViewPluginForTest as unknown as ViewPlugin<SpellcheckPluginValue>,
  );
  expect(plugin).toBeDefined();
  if (!plugin) {
    throw new Error("spellcheck plugin is not installed");
  }
  return plugin;
}

function getSpellcheckPluginOrNull(v: EditorView): SpellcheckPluginValue | null {
  return v.plugin(
    _spellcheckMarkViewPluginForTest as unknown as ViewPlugin<SpellcheckPluginValue>,
  );
}

function getNoSpellcheckTexts(v: EditorView): string[] {
  const texts: string[] = [];
  getSpellcheckPlugin(v).decorations.between(0, v.state.doc.length, (from, to, value) => {
    const attributes = value.spec.attributes as Record<string, string> | undefined;
    if (from < to && attributes?.spellcheck === "false") {
      texts.push(v.state.sliceDoc(from, to));
    }
  });
  return texts;
}

describe("spellcheckExtension", () => {
  it("defaults to enabled in state and on the editor content DOM", () => {
    const v = createSpellcheckView("Alpha $x$ and [@solo].");

    expect(v.state.field(spellcheckEnabledField)).toBe(true);
    expect(v.contentDOM.getAttribute("spellcheck")).toBe("true");
    expect(getSpellcheckPlugin(v)).toBeDefined();
  });

  it("toggleSpellcheck keeps the state field and compartment in sync", () => {
    const v = createSpellcheckView("Alpha $x$ and [@solo].");

    expect(toggleSpellcheck(v)).toBe(true);
    expect(v.state.field(spellcheckEnabledField)).toBe(false);
    expect(v.contentDOM.getAttribute("spellcheck")).toBe("false");
    expect(getSpellcheckPluginOrNull(v)).toBeNull();

    expect(toggleSpellcheck(v)).toBe(true);
    expect(v.state.field(spellcheckEnabledField)).toBe(true);
    expect(v.contentDOM.getAttribute("spellcheck")).toBe("true");
    expect(getSpellcheckPlugin(v)).toBeDefined();
  });

  it("marks math, code, and only single-id references as spellcheck=false", () => {
    const v = createSpellcheckView("Math $x$ and `code` with [@solo] but not [@one; @two].");
    const texts = getNoSpellcheckTexts(v);

    expect(texts).toHaveLength(3);
    expect(texts).toEqual(expect.arrayContaining([
      "$x$",
      "`code`",
      "[@solo]",
    ]));
    expect(texts).not.toContain("[@one; @two]");
  });

  it("rebuilds decorations for doc and viewport changes, but not plain selection moves", () => {
    const doc = "Math $x$ and [@solo].";
    const v = createSpellcheckView(doc, doc.length);
    const beforeSelection = getSpellcheckPlugin(v).decorations;

    v.dispatch({ selection: { anchor: 0 } });
    expect(getSpellcheckPlugin(v).decorations).toBe(beforeSelection);

    v.dispatch({
      changes: {
        from: doc.indexOf("x"),
        to: doc.indexOf("x") + 1,
        insert: "y",
      },
    });

    const afterDocChange = getSpellcheckPlugin(v).decorations;
    expect(afterDocChange).not.toBe(beforeSelection);

    getSpellcheckPlugin(v).update({
      view: v,
      startState: v.state,
      state: v.state,
      docChanged: false,
      viewportChanged: true,
    } as ViewUpdate);

    expect(getSpellcheckPlugin(v).decorations).not.toBe(afterDocChange);
  });
});
