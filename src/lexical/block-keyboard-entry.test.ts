import { afterEach, describe, expect, it } from "vitest";

import {
  blockKeyboardActivationProps,
  blockKeyboardEntryProps,
  queryBlockKeyboardActivationTarget,
  queryBlockKeyboardEditableTargets,
  syncBlockKeyboardEntryAttribute,
} from "./block-keyboard-entry";

describe("block-keyboard-entry", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("creates and syncs keyboard entry attributes through one API", () => {
    expect(blockKeyboardActivationProps(true)).toEqual({
      "data-coflat-block-keyboard-activation": "true",
    });
    expect(blockKeyboardActivationProps(false)).toEqual({});
    expect(blockKeyboardEntryProps("primary")).toEqual({
      "data-coflat-block-keyboard-entry": "primary",
    });

    const element = document.createElement("td");
    syncBlockKeyboardEntryAttribute(element, "primary");
    expect(element.getAttribute("data-coflat-block-keyboard-entry")).toBe("primary");
    syncBlockKeyboardEntryAttribute(element);
    expect(element.hasAttribute("data-coflat-block-keyboard-entry")).toBe(false);
  });

  it("prefers visible primary nested editors for block traversal", () => {
    document.body.innerHTML = [
      "<section>",
      "  <div contenteditable='true' data-name='fallback'></div>",
      "  <div data-coflat-block-keyboard-entry='primary'>",
      "    <div contenteditable='true' class='cf-lexical-editor--hidden' data-name='hidden-primary'></div>",
      "    <div contenteditable='true' data-name='primary'></div>",
      "  </div>",
      "  <button data-coflat-block-keyboard-activation='true'>Edit</button>",
      "</section>",
    ].join("");

    const root = document.querySelector("section");
    if (!(root instanceof HTMLElement)) {
      throw new Error("missing test root");
    }

    expect(queryBlockKeyboardEditableTargets(root).map((node) => node.dataset.name)).toEqual([
      "primary",
    ]);
    expect(queryBlockKeyboardActivationTarget(root)?.textContent).toBe("Edit");
  });
});
