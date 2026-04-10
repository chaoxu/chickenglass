import { markdown } from "@codemirror/lang-markdown";
import {
  Compartment,
  EditorState,
} from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { strikethroughExtension } from "../parser";
import { createChangeChecker } from "./change-detection";

function createMarkdownState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown()],
  });
}

function sameNumberSet(
  before: ReadonlySet<number>,
  after: ReadonlySet<number>,
): boolean {
  if (before.size !== after.size) return false;
  for (const value of before) {
    if (!after.has(value)) return false;
  }
  return true;
}

describe("createChangeChecker", () => {
  it("returns false when selected values stay equal", () => {
    const checker = createChangeChecker((state) => state.doc.lines);
    const state = createMarkdownState("one\ntwo");
    const tr = state.update({ selection: { anchor: 2 } });

    expect(checker(tr)).toBe(false);
  });

  it("returns true when a selected value changes", () => {
    const checker = createChangeChecker((state) => state.selection.main.anchor);
    const state = createMarkdownState("hello");
    const tr = state.update({ selection: { anchor: 2 } });

    expect(checker(tr)).toBe(true);
  });

  it("supports comparing explicit before/after states", () => {
    const checker = createChangeChecker((state) => state.selection.main.anchor);
    const beforeState = createMarkdownState("hello");
    const afterState = beforeState.update({ selection: { anchor: 2 } }).state;

    expect(checker(beforeState, afterState)).toBe(true);
  });

  it("returns true when doc checking is enabled", () => {
    const checker = createChangeChecker({ doc: true });
    const state = createMarkdownState("hello");
    const tr = state.update({ changes: { from: 0, insert: "x" } });

    expect(checker(tr)).toBe(true);
  });

  it("supports doc checking across explicit before/after states", () => {
    const checker = createChangeChecker({ doc: true });
    const beforeState = createMarkdownState("hello");
    const afterState = beforeState.update({ changes: { from: 0, insert: "x" } }).state;

    expect(checker(beforeState, afterState)).toBe(true);
  });

  it("returns true when tree checking is enabled", () => {
    const language = new Compartment();
    const checker = createChangeChecker({ tree: true });
    const state = EditorState.create({
      doc: "~~strike~~",
      extensions: [language.of(markdown())],
    });
    const tr = state.update({
      effects: language.reconfigure(markdown({ extensions: [strikethroughExtension] })),
    });

    expect(tr.docChanged).toBe(false);
    expect(checker(tr)).toBe(true);
  });

  it("supports tree checking across explicit before/after states", () => {
    const language = new Compartment();
    const checker = createChangeChecker({ tree: true });
    const beforeState = EditorState.create({
      doc: "~~strike~~",
      extensions: [language.of(markdown())],
    });
    const afterState = beforeState.update({
      effects: language.reconfigure(markdown({ extensions: [strikethroughExtension] })),
    }).state;

    expect(checker(beforeState, afterState)).toBe(true);
  });

  it("uses custom equality for derived values", () => {
    const checker = createChangeChecker({
      get: (state) => new Set([state.selection.main.anchor % 2]),
      equals: sameNumberSet,
    });
    const state = createMarkdownState("hello");
    const sameParity = state.update({ selection: { anchor: 2 } });
    const differentParity = state.update({ selection: { anchor: 1 } });

    expect(checker(sameParity)).toBe(false);
    expect(checker(differentParity)).toBe(true);
  });
});
