import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import {
  _computeActivePath_forTest as computeActivePath,
  _fenceGuideField_forTest as fenceGuideField,
  fenceGuidePlugin,
} from "./fence-guide";
import { focusEffect } from "./render-utils";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Create state with markdown parser + fence guide field + focus set. */
function createState(
  doc: string,
  cursorPos: number,
  focused = true,
): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ extensions: markdownExtensions }),
      fenceGuidePlugin,
    ],
  });
  if (focused) {
    return state.update({ effects: focusEffect.of(true) }).state;
  }
  return state;
}

/** Extract line numbers that have a fence-guide decoration. */
function getGuideLineNumbers(state: EditorState): number[] {
  const { decorations } = state.field(fenceGuideField);
  const lines: number[] = [];
  const iter = decorations.iter();
  while (iter.value) {
    lines.push(state.doc.lineAt(iter.from).number);
    iter.next();
  }
  return lines;
}

/** Extract depth class (e.g. 1, 2) for each decorated line. */
function getGuideDepths(state: EditorState): Array<{ line: number; depth: number }> {
  const { decorations } = state.field(fenceGuideField);
  const result: Array<{ line: number; depth: number }> = [];
  const iter = decorations.iter();
  while (iter.value) {
    const cls = iter.value.spec.class as string;
    const match = cls.match(/cf-fence-d(\d)/);
    result.push({
      line: state.doc.lineAt(iter.from).number,
      depth: match ? Number(match[1]) : 0,
    });
    iter.next();
  }
  return result;
}

/** Apply a selection change and return the new state. */
function moveCursor(state: EditorState, pos: number): EditorState {
  return state.update({ selection: { anchor: pos } }).state;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const SINGLE_DIV = `::: {.theorem}
Content line 1
Content line 2
:::`;
// line 1: ::: {.theorem}   (0..14)
// line 2: Content line 1   (15..29)
// line 3: Content line 2   (30..44)
// line 4: :::              (45..47)

const NESTED_DIV = `::: {.theorem}
Outer content
::: {.proof}
Inner content
:::
:::`;
// line 1: ::: {.theorem}   (0..14)
// line 2: Outer content    (15..28)
// line 3: ::: {.proof}     (29..41)
// line 4: Inner content    (42..55)
// line 5: :::              (56..58)
// line 6: :::              (59..61)

const TWO_SIBLING_DIVS = `::: {.theorem}
Thm content
:::

::: {.proof}
Proof content
:::`;

// ── Tests ──────────────────────────────────────────────────────────────────

describe("fence-guide active path", () => {
  it("returns empty when unfocused", () => {
    const state = createState(SINGLE_DIV, 16, false);
    expect(computeActivePath(state)).toBe("");
  });

  it("returns empty when cursor is outside any fenced div", () => {
    const doc = "plain text\n" + SINGLE_DIV;
    const state = createState(doc, 5); // in "plain text"
    expect(computeActivePath(state)).toBe("");
  });

  it("returns a non-empty path when cursor is inside a fenced div", () => {
    const state = createState(SINGLE_DIV, 16); // "Content line 1"
    expect(computeActivePath(state)).not.toBe("");
  });

  it("returns the same path for different positions in the same div", () => {
    const s1 = createState(SINGLE_DIV, 16); // line 2
    const s2 = createState(SINGLE_DIV, 31); // line 3
    expect(computeActivePath(s1)).toBe(computeActivePath(s2));
  });

  it("returns different paths for cursor inside vs outside a div", () => {
    const doc = "plain text\n" + SINGLE_DIV;
    const inside = createState(doc, 26); // inside the div
    const outside = createState(doc, 5); // "plain text"
    expect(computeActivePath(inside)).not.toBe(computeActivePath(outside));
  });

  it("returns different paths for different sibling divs", () => {
    const s1 = createState(TWO_SIBLING_DIVS, 16); // inside theorem
    const s2 = createState(TWO_SIBLING_DIVS, 36); // inside proof
    expect(computeActivePath(s1)).not.toBe(computeActivePath(s2));
  });

  it("returns a deeper path for nested position", () => {
    const outer = createState(NESTED_DIV, 16); // "Outer content"
    const inner = createState(NESTED_DIV, 43); // "Inner content"
    const outerPath = computeActivePath(outer);
    const innerPath = computeActivePath(inner);
    // Inner path should contain more entries (2 divs vs 1)
    expect(innerPath.split(",").length).toBeGreaterThan(
      outerPath.split(",").length,
    );
  });
});

describe("fence-guide decorations", () => {
  it("produces no decorations when unfocused", () => {
    const state = createState(SINGLE_DIV, 16, false);
    expect(getGuideLineNumbers(state)).toEqual([]);
  });

  it("decorates all lines of the active div", () => {
    const state = createState(SINGLE_DIV, 16);
    const lines = getGuideLineNumbers(state);
    expect(lines).toEqual([1, 2, 3, 4]);
  });

  it("produces no decorations when cursor is outside all divs", () => {
    const doc = "plain text\n" + SINGLE_DIV;
    const state = createState(doc, 5);
    expect(getGuideLineNumbers(state)).toEqual([]);
  });

  it("shows depth-2 guides for nested region", () => {
    const state = createState(NESTED_DIV, 43); // "Inner content"
    const depths = getGuideDepths(state);
    const d2 = depths.filter((d) => d.depth === 2);
    expect(d2.length).toBeGreaterThan(0);
  });
});

describe("fence-guide rebuild skipping", () => {
  it("reuses decorations when cursor moves within the same div", () => {
    const state = createState(SINGLE_DIV, 16); // line 2
    const { decorations: before } = state.field(fenceGuideField);

    const moved = moveCursor(state, 31); // line 3, same div
    const { decorations: after } = moved.field(fenceGuideField);

    // Same object reference — rebuild was skipped
    expect(after).toBe(before);
  });

  it("rebuilds when cursor moves from one sibling div to another", () => {
    const state = createState(TWO_SIBLING_DIVS, 16); // theorem
    const { decorations: before } = state.field(fenceGuideField);

    const moved = moveCursor(state, 36); // proof
    const { decorations: after } = moved.field(fenceGuideField);

    expect(after).not.toBe(before);
  });

  it("rebuilds when cursor moves from inside to outside a div", () => {
    const doc = "plain text\n" + SINGLE_DIV;
    const state = createState(doc, 26); // inside div
    const { decorations: before } = state.field(fenceGuideField);

    const moved = moveCursor(state, 5); // outside
    const { decorations: after } = moved.field(fenceGuideField);

    expect(after).not.toBe(before);
  });

  it("rebuilds when focus is lost", () => {
    const state = createState(SINGLE_DIV, 16);
    const { decorations: before } = state.field(fenceGuideField);
    expect(getGuideLineNumbers(state).length).toBeGreaterThan(0);

    const blurred = state.update({ effects: focusEffect.of(false) }).state;
    const { decorations: after } = blurred.field(fenceGuideField);

    expect(after).not.toBe(before);
    expect(getGuideLineNumbers(blurred)).toEqual([]);
  });

  it("rebuilds on doc change even if cursor stays in same position", () => {
    const state = createState(SINGLE_DIV, 16);
    const { decorations: before } = state.field(fenceGuideField);

    // Insert text at the beginning — shifts all positions
    const edited = state.update({
      changes: { from: 0, to: 0, insert: "X" },
    }).state;
    const { decorations: after } = edited.field(fenceGuideField);

    expect(after).not.toBe(before);
  });
});

describe("fence-guide fence boundary correctness", () => {
  it("shows guides when cursor is on the opening fence", () => {
    const state = createState(SINGLE_DIV, 0); // start of "::: {.theorem}"
    expect(getGuideLineNumbers(state)).toEqual([1, 2, 3, 4]);
  });

  it("shows guides when cursor is on the closing fence", () => {
    const state = createState(SINGLE_DIV, 45); // start of closing ":::"
    expect(getGuideLineNumbers(state)).toEqual([1, 2, 3, 4]);
  });

  it("hides guides when cursor is after the closing fence", () => {
    const doc = SINGLE_DIV + "\nafter";
    const state = createState(doc, 49); // "after" line
    expect(getGuideLineNumbers(state)).toEqual([]);
  });
});
