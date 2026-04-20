import { EditorState, type Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { CSS } from "../constants/css-classes";
import type { FencedDivInfo } from "../fenced-block/model";
import {
  getDecorationSpecs,
  hasLineClassAt,
} from "../test-utils";
import { DecorationBuilder } from "./decoration-builder";
import { applySpecialBehavior } from "./special-behavior-handlers";

function makeDiv(
  state: EditorState,
  className: string,
  overrides: Partial<FencedDivInfo> = {},
): FencedDivInfo {
  const openLine = state.doc.line(1);
  const closeLine = state.doc.line(state.doc.lines);
  return {
    from: openLine.from,
    to: closeLine.to,
    openFenceFrom: openLine.from,
    openFenceTo: openLine.to,
    closeFenceFrom: closeLine.from,
    closeFenceTo: closeLine.to,
    singleLine: false,
    isSelfClosing: false,
    classes: [className],
    primaryClass: className,
    id: undefined,
    title: undefined,
    className,
    ...overrides,
  };
}

function collectSpecs(items: Range<Decoration>[]) {
  return getDecorationSpecs(Decoration.set(items, true));
}

describe("DecorationBuilder", () => {
  it("adds a qed marker to the last content line", () => {
    const state = EditorState.create({
      doc: "::: {.proof}\nText\n:::",
    });
    const div = makeDiv(state, "proof");
    const items: Range<Decoration>[] = [];

    new DecorationBuilder(items).addQedDecoration(state, div);
    const specs = collectSpecs(items);

    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.blockQed)).toBe(true);
  });
});

describe("applySpecialBehavior", () => {
  it("routes qed behavior through the shared handler registry", () => {
    const state = EditorState.create({
      doc: "::: {.proof}\nText\n:::",
    });
    const div = makeDiv(state, "proof");
    const items: Range<Decoration>[] = [];
    const builder = new DecorationBuilder(items);

    applySpecialBehavior("qed", {
      state,
      div,
      builder,
      openLine: state.doc.line(1),
      activeShell: false,
      openerSourceActive: false,
    });

    const specs = collectSpecs(items);
    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.blockQed)).toBe(true);
  });
});
