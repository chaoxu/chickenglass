import { afterEach, describe, expect, it } from "vitest";
import { readEmbeddedInlineDomSelection } from "./embedded-selection";
import {
  SOURCE_POSITION_DATASET,
  setSourceRange,
} from "./source-position-contract";

function selectText(node: Text, from: number, to: number): void {
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("readEmbeddedInlineDomSelection", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.textContent = "";
  });

  it("maps title selections locally instead of matching unrelated bold body text", () => {
    const raw = [
      '::: {.theorem title="Title"}',
      "Body.",
      ":::",
    ].join("\n");
    const doc = [
      raw,
      "",
      "Outside **Title** text.",
    ].join("\n");
    const rawBlock = document.createElement("section");
    rawBlock.dataset[SOURCE_POSITION_DATASET.rawBlock] = "true";
    setSourceRange(rawBlock, 0, raw.length);

    const titleShell = document.createElement("div");
    titleShell.className = "cf-lexical-block-title";
    const titleRoot = document.createElement("div");
    titleRoot.setAttribute("contenteditable", "true");
    const titleText = document.createTextNode("Title");
    titleRoot.append(titleText);
    titleShell.append(titleRoot);
    rawBlock.append(titleShell);
    document.body.append(rawBlock);

    selectText(titleText, 0, "Title".length);

    const titleStart = raw.indexOf("Title");
    const bodyBoldStart = doc.indexOf("**Title**") + 2;

    expect(readEmbeddedInlineDomSelection(doc)).toEqual({
      anchor: titleStart,
      focus: titleStart + "Title".length,
      from: titleStart,
      to: titleStart + "Title".length,
    });
    expect(readEmbeddedInlineDomSelection(doc)?.from).not.toBe(bodyBoldStart);
  });
});
