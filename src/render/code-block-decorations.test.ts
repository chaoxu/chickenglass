/**
 * Focused unit tests for code-block-decorations.ts.
 *
 * Note: extensive coverage of the StateField update lifecycle (incremental
 * rebuild paths, structure-revision invalidation, copy-button reset timer)
 * already exists in code-block-render.test.ts via the test re-exports there.
 * This file focuses on the rendered DOM produced by the language label and
 * copy-button widgets, plus the directly exported helpers
 * `computeCodeBlockDirtyRegion` and `docChangeTouchesCodeBlockContent`.
 *
 * Widget classes (CopyButtonWidget, CodeBlockLanguageWidget) are private to
 * the module, so we mount a live EditorView and inspect the rendered DOM
 * rather than instantiating widgets directly.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

import {
  computeCodeBlockDirtyRegion,
  codeBlockDecorationField,
  docChangeTouchesCodeBlockContent,
} from "./code-block-decorations";
import { editorFocusField, focusEffect } from "./focus-state";
import { CSS } from "../constants/css-classes";
import { markdownExtensions } from "../parser";
import { activeStructureEditField } from "../state/cm-structure-edit";
import {
  codeBlockStructureField,
  collectCodeBlocks,
} from "../state/code-block-structure";

const activeViews = new Set<EditorView>();

afterEach(() => {
  for (const view of [...activeViews]) {
    view.destroy();
  }
  activeViews.clear();
  document.body.innerHTML = "";
});

function createView(doc: string, cursorPos = 0, focused = true): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const extensions: Extension[] = [
    markdown({ extensions: markdownExtensions }),
    editorFocusField,
    activeStructureEditField,
    codeBlockStructureField,
    codeBlockDecorationField,
  ];
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions,
    }),
    parent,
  });
  if (focused) {
    view.dispatch({ effects: focusEffect.of(true) });
  }
  activeViews.add(view);
  return view;
}

function createParsedState(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      editorFocusField,
      activeStructureEditField,
      codeBlockStructureField,
      codeBlockDecorationField,
    ],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

describe("CodeBlockLanguageWidget DOM", () => {
  it("renders the explicit language hint as a label widget", () => {
    const view = createView("```python\nprint('x')\n```", 12);
    const label = view.dom.querySelector(`.${CSS.codeblockLanguage}`);
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("python");
  });

  it("renders an empty label when the fence has no language hint", () => {
    const view = createView("```\nplain code\n```", 7);
    const label = view.dom.querySelector(`.${CSS.codeblockLanguage}`);
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("");
  });

  it("renders an independent label for each adjacent code block", () => {
    const doc = [
      "```js",
      "console.log('a')",
      "```",
      "",
      "```py",
      "print('b')",
      "```",
    ].join("\n");
    // Cursor in the first body line so both blocks render headers.
    const view = createView(doc, doc.indexOf("console"));
    const labels = view.dom.querySelectorAll(`.${CSS.codeblockLanguage}`);
    expect(labels.length).toBe(2);
    expect(labels[0].textContent).toBe("js");
    expect(labels[1].textContent).toBe("py");
  });
});

describe("CopyButtonWidget DOM", () => {
  it("mounts a copy-to-clipboard button with the expected aria label", () => {
    const view = createView("```js\nconsole.log('hi')\n```", 8);
    const button = view.dom.querySelector<HTMLButtonElement>(".cf-codeblock-copy");
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.type).toBe("button");
    expect(button?.getAttribute("aria-label")).toBe("Copy code to clipboard");
    // Lucide icon should be embedded.
    expect(button?.querySelector("svg")).not.toBeNull();
  });

  it("does NOT mount a copy button for an empty (zero-body-line) code block", () => {
    // Empty blocks have no copyable content; skipping the button avoids a
    // dangling decoration that copies an empty string.
    const view = createView("```js\n```", 0);
    expect(view.dom.querySelector(".cf-codeblock-copy")).toBeNull();
  });

  it("renders one copy button per code block", () => {
    const doc = [
      "```js",
      "console.log('a')",
      "```",
      "",
      "```py",
      "print('b')",
      "```",
    ].join("\n");
    const view = createView(doc, doc.indexOf("console"));
    const buttons = view.dom.querySelectorAll(".cf-codeblock-copy");
    expect(buttons.length).toBe(2);
  });
});

describe("computeCodeBlockDirtyRegion", () => {
  it("returns null when no doc changes are present", () => {
    const state = createParsedState("```js\nconsole.log('x')\n```");
    // selection-only transaction → no changed ranges
    const tr = state.update({ selection: { anchor: 5 } });
    expect(computeCodeBlockDirtyRegion(tr)).toBeNull();
  });

  it("expands the dirty region to cover the surrounding code block", () => {
    const doc = "before\n```js\nconsole.log('x')\n```\nafter";
    const state = createParsedState(doc);
    const blockStart = doc.indexOf("```");
    // Edit a single character inside the body
    const insertPos = doc.indexOf("console") + 1;
    const tr = state.update({ changes: { from: insertPos, to: insertPos, insert: "X" } });
    ensureSyntaxTree(tr.state, tr.state.doc.length, 5000);
    const dirty = computeCodeBlockDirtyRegion(tr);
    expect(dirty).not.toBeNull();
    // The dirty region should fully encompass the (now-mapped) code block.
    expect(dirty!.filterFrom).toBeLessThanOrEqual(blockStart);
    expect(dirty!.filterTo).toBeGreaterThanOrEqual(
      tr.changes.mapPos(doc.indexOf("```", blockStart + 3) + 3),
    );
  });
});

describe("docChangeTouchesCodeBlockContent", () => {
  it("reports true for an edit inside the body of a code block", () => {
    const doc = "```js\nconsole.log('x')\n```";
    const state = createParsedState(doc);
    const blocks = collectCodeBlocks(state);
    const insertPos = doc.indexOf("console") + 1;
    const tr = state.update({ changes: { from: insertPos, to: insertPos, insert: "Y" } });
    expect(docChangeTouchesCodeBlockContent(blocks, tr.changes)).toBe(true);
  });

  it("reports false for prose-only edits outside any code block", () => {
    const doc = "before\n```js\nconsole.log('x')\n```\nafter";
    const state = createParsedState(doc);
    const blocks = collectCodeBlocks(state);
    // Insert into the trailing "after" prose
    const insertPos = doc.indexOf("after");
    const tr = state.update({ changes: { from: insertPos, to: insertPos, insert: "z" } });
    expect(docChangeTouchesCodeBlockContent(blocks, tr.changes)).toBe(false);
  });

  it("reports false when there are no code blocks at all", () => {
    const state = createParsedState("just prose without any fence");
    const blocks = collectCodeBlocks(state);
    expect(blocks.length).toBe(0);
    const tr = state.update({ changes: { from: 0, to: 0, insert: "x" } });
    expect(docChangeTouchesCodeBlockContent(blocks, tr.changes)).toBe(false);
  });
});
