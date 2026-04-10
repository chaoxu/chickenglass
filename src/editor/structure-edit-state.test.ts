import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../parser";
import { documentSemanticsField } from "../state/document-analysis";
import { applyStateEffects } from "../test-utils";
import { frontmatterField } from "./frontmatter-state";
import { programmaticDocumentChangeAnnotation } from "./programmatic-document-change";
import {
  activeStructureEditField,
  createFencedStructureEditTarget,
  createStructureEditTargetAt,
  getActiveStructureEditTarget,
  setStructureEditTargetEffect,
} from "./structure-edit-state";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
    ],
  });
}

describe("structure-edit-state", () => {
  it("maps an active fenced-block target through document edits before the block", () => {
    const doc = `::: {.theorem} Title\nBody\n:::`;
    const state = createState(doc);
    const target = createFencedStructureEditTarget(state, 0);
    expect(target).not.toBeNull();

    const active = applyStateEffects(state, setStructureEditTargetEffect.of(target));
    const shifted = active.update({
      changes: { from: 0, insert: "Intro\n\n" },
    }).state;
    const mapped = getActiveStructureEditTarget(shifted);

    expect(mapped?.kind).toBe("fenced-opener");
    if (!mapped || mapped.kind !== "fenced-opener") {
      throw new Error("expected mapped fenced-opener target");
    }
    expect(mapped.openFenceFrom).toBe(7);
    expect(mapped.title).toBe("Title");
  });

  it("clears an active fenced-block target when the block is deleted", () => {
    const doc = `::: {.proof}\nBody\n:::`;
    const state = createState(doc);
    const target = createFencedStructureEditTarget(state, 0);
    expect(target).not.toBeNull();

    const active = applyStateEffects(state, setStructureEditTargetEffect.of(target));
    const deleted = active.update({
      changes: { from: 0, to: doc.length, insert: "Plain text" },
    }).state;

    expect(getActiveStructureEditTarget(deleted)).toBeNull();
  });

  it("re-resolves the frontmatter target against the current frontmatter extent", () => {
    const doc = ["---", "title: Hello", "---", "Body"].join("\n");
    const state = createState(doc);
    const target = createStructureEditTargetAt(state, 0);
    expect(target?.kind).toBe("frontmatter");

    const active = applyStateEffects(state, setStructureEditTargetEffect.of(target));
    const edited = active.update({
      changes: {
        from: doc.indexOf("Hello"),
        to: doc.indexOf("Hello") + "Hello".length,
        insert: "Hello World",
      },
    }).state;
    const mapped = getActiveStructureEditTarget(edited);

    expect(mapped?.kind).toBe("frontmatter");
    if (!mapped || mapped.kind !== "frontmatter") {
      throw new Error("expected mapped frontmatter target");
    }
    expect(mapped.to).toBe(edited.field(frontmatterField).end);
  });

  it("does not create structure-edit targets for inline math or references", () => {
    const doc = "See $x^2$ and [@karger2000].";
    const state = createState(doc);

    expect(createStructureEditTargetAt(state, doc.indexOf("$x^2$") + 1)).toBeNull();
    expect(createStructureEditTargetAt(state, doc.indexOf("[@karger2000]") + 2)).toBeNull();
  });

  it("creates a structure-edit target for display math", () => {
    const doc = ["before", "", "$$x^2$$", "", "after"].join("\n");
    const state = createState(doc);
    const target = createStructureEditTargetAt(state, doc.indexOf("x^2"));

    expect(target?.kind).toBe("display-math");
  });

  it("prefers display math over the surrounding fenced block when both overlap", () => {
    const doc = [
      "::: {.proposition}",
      "1. Item",
      "2. Display math in fenced div list:",
      "   \\[",
      "   x^2 + y^2 = z^2",
      "   \\]",
      "3. Next item",
      ":::",
    ].join("\n");
    const state = createState(doc);
    const target = createStructureEditTargetAt(state, doc.indexOf("x^2"));

    expect(target?.kind).toBe("display-math");
  });

  it("prefers the innermost fenced block opener in nested fenced divs", () => {
    const doc = [
      ":::: {.theorem} Hover Preview Stress Test",
      "Outer content",
      "",
      "::: {.blockquote} Blockquote",
      "Inner quote body",
      ":::",
      "::::",
    ].join("\n");
    const state = createState(doc);
    const target = createStructureEditTargetAt(state, doc.indexOf("Blockquote"));

    expect(target?.kind).toBe("fenced-opener");
    if (!target || target.kind !== "fenced-opener") {
      throw new Error("expected nested fenced-opener target");
    }
    expect(target.className).toBe("blockquote");
    expect(target.openFenceFrom).toBe(doc.indexOf("::: {.blockquote}"));
  });

  it("clears structure edit when a programmatic document replacement switches files", () => {
    const state = createState(["---", "title: Hello", "---", "Body"].join("\n"));
    const target = createStructureEditTargetAt(state, 0);
    expect(target?.kind).toBe("frontmatter");

    const active = applyStateEffects(state, setStructureEditTargetEffect.of(target));
    const replaced = active.update({
      changes: {
        from: 0,
        to: active.doc.length,
        insert: ["---", "title: Next Doc", "---", "Other"].join("\n"),
      },
      annotations: programmaticDocumentChangeAnnotation.of(true),
    }).state;

    expect(getActiveStructureEditTarget(replaced)).toBeNull();
  });
});
