import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { focusModeExtension, toggleFocusMode } from "./focus-mode";
import { CSS } from "../constants/css-classes";
import { createTestView } from "../test-utils";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

/** Create a view with focus mode extension and the given document. */
function setup(doc: string, cursorPos = 0): EditorView {
  view = createTestView(doc, {
    cursorPos,
    extensions: focusModeExtension,
  });
  return view;
}

/** Extract dimmed line numbers from all active decorations in the view. */
function getDimmedLineNumbers(v: EditorView): number[] {
  const lineNumbers: number[] = [];
  const allDecos = v.state.facet(EditorView.decorations);
  for (const decoSource of allDecos) {
    const decoSet = typeof decoSource === "function" ? decoSource(v) : decoSource;
    const iter = decoSet.iter();
    while (iter.value) {
      if (iter.value.spec?.class === CSS.focusDimmed) {
        lineNumbers.push(v.state.doc.lineAt(iter.from).number);
      }
      iter.next();
    }
  }
  return lineNumbers;
}

describe("focus mode", () => {
  describe("toggle", () => {
    it("starts inactive — no dimming", () => {
      const v = setup("Hello\n\nWorld");
      expect(getDimmedLineNumbers(v)).toEqual([]);
    });

    it("toggles on with toggleFocusMode command", () => {
      const v = setup("Hello\n\nWorld");
      toggleFocusMode(v);
      // Now focus mode is active — some lines should be dimmed
      const dimmed = getDimmedLineNumbers(v);
      expect(dimmed.length).toBeGreaterThan(0);
    });

    it("toggles off when called twice", () => {
      const v = setup("Hello\n\nWorld");
      toggleFocusMode(v);
      toggleFocusMode(v);
      expect(getDimmedLineNumbers(v)).toEqual([]);
    });

    it("returns true (consumed command)", () => {
      const v = setup("Hello");
      expect(toggleFocusMode(v)).toBe(true);
    });
  });

  describe("paragraph dimming", () => {
    it("dims lines outside the cursor paragraph", () => {
      // Cursor at position 0 = line 1 ("First para")
      // Lines 1-2 are the first paragraph (contiguous non-blank).
      // Line 3 is blank.
      // Lines 4-5 are the second paragraph.
      const doc = "First para\nstill first\n\nSecond para\nstill second";
      const v = setup(doc, 0);
      toggleFocusMode(v);

      const dimmed = getDimmedLineNumbers(v);
      // Line 3 (blank), 4, 5 should be dimmed
      expect(dimmed).toContain(3);
      expect(dimmed).toContain(4);
      expect(dimmed).toContain(5);
      // Lines 1 and 2 should NOT be dimmed
      expect(dimmed).not.toContain(1);
      expect(dimmed).not.toContain(2);
    });

    it("dims everything except the second paragraph when cursor is there", () => {
      const doc = "Alpha\n\nBeta\nGamma\n\nDelta";
      // Place cursor on "Beta" (line 3)
      const cursorPos = doc.indexOf("Beta");
      const v = setup(doc, cursorPos);
      toggleFocusMode(v);

      const dimmed = getDimmedLineNumbers(v);
      // Lines 3-4 (Beta, Gamma) are the active paragraph
      expect(dimmed).not.toContain(3);
      expect(dimmed).not.toContain(4);
      // Lines 1 (Alpha), 2 (blank), 5 (blank), 6 (Delta) should be dimmed
      expect(dimmed).toContain(1);
      expect(dimmed).toContain(2);
      expect(dimmed).toContain(5);
      expect(dimmed).toContain(6);
    });

    it("does not dim any line when document is a single paragraph", () => {
      const doc = "one\ntwo\nthree";
      const v = setup(doc, 0);
      toggleFocusMode(v);

      expect(getDimmedLineNumbers(v)).toEqual([]);
    });

    it("absorbs adjacent blank line into the paragraph above", () => {
      // "Above\n\n\nBelow" has lines: 1="Above", 2="", 3="", 4="Below"
      // Cursor on line 2 (blank). findParagraphRange expands upward
      // through non-blank lines, so line 1 joins the range: paragraph = 1-2.
      const doc = "Above\n\n\nBelow";
      const cursorPos = doc.indexOf("\n\n") + 1; // start of line 2
      const v = setup(doc, cursorPos);
      toggleFocusMode(v);

      const dimmed = getDimmedLineNumbers(v);
      // Lines 1-2 are the active paragraph (blank line absorbed upward)
      expect(dimmed).not.toContain(1);
      expect(dimmed).not.toContain(2);
      // Lines 3-4 are dimmed
      expect(dimmed).toContain(3);
      expect(dimmed).toContain(4);
    });

    it("updates dimming when selection changes", () => {
      const doc = "Para A\n\nPara B\n\nPara C";
      const v = setup(doc, 0);
      toggleFocusMode(v);

      // Initially cursor on line 1 — Para A not dimmed
      expect(getDimmedLineNumbers(v)).not.toContain(1);
      expect(getDimmedLineNumbers(v)).toContain(3);

      // Move cursor to Para B
      const paraBPos = doc.indexOf("Para B");
      v.dispatch({ selection: { anchor: paraBPos } });

      const dimmed = getDimmedLineNumbers(v);
      expect(dimmed).not.toContain(3);
      expect(dimmed).toContain(1);
      expect(dimmed).toContain(5);
    });
  });

  describe("edge cases", () => {
    it("handles empty document", () => {
      const v = setup("");
      toggleFocusMode(v);
      // Single empty line — nothing to dim
      expect(getDimmedLineNumbers(v)).toEqual([]);
    });

    it("handles single-line document", () => {
      const v = setup("Only line");
      toggleFocusMode(v);
      expect(getDimmedLineNumbers(v)).toEqual([]);
    });

    it("handles document ending with blank lines", () => {
      const doc = "Content\n\n";
      const v = setup(doc, 0);
      toggleFocusMode(v);

      const dimmed = getDimmedLineNumbers(v);
      expect(dimmed).not.toContain(1);
      // Trailing blank lines should be dimmed
      expect(dimmed).toContain(2);
      expect(dimmed).toContain(3);
    });
  });
});
