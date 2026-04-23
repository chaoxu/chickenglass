/**
 * Unit tests for block-type picker logic.
 *
 * Tests the pure-logic functions: entry filtering (getPickerEntries),
 * block insertion with ancestor fence upgrades (insertBlock), and
 * ancestor fence collection from the Lezer tree (collectAncestorFences).
 * Also covers the picker UI trigger path at a light integration level.
 */

import { describe, expect, it, afterEach, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { markdownExtensions } from "../parser";
import {
  blockTypePickerExtension,
  isPickerVisible,
  _getPickerEntriesForTest as getPickerEntries,
  _insertBlockForTest as insertBlock,
  _collectAncestorFencesForTest as collectAncestorFences,
} from "./block-type-picker";
import {
  registerPlugins,
  createRegistryState,
} from "../plugins";
import { frontmatterField } from "./frontmatter-state";
import { createPluginRegistryField } from "../state/plugin-registry";
import { createTestView, makeBlockPlugin } from "../test-utils";

vi.mock("@floating-ui/dom", async () => {
  const actual = await vi.importActual<typeof import("@floating-ui/dom")>("@floating-ui/dom");
  return {
    ...actual,
    computePosition: vi.fn(async () => ({ x: 12, y: 34 })),
  };
});

class ResizeObserverStub {
  disconnect = vi.fn();
  observe() {}
  unobserve() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
  configurable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard plugins used in most tests. */
const standardPlugins = [
  makeBlockPlugin({ name: "theorem" }),
  makeBlockPlugin({ name: "lemma" }),
  makeBlockPlugin({ name: "proof", numbered: false }),
  makeBlockPlugin({ name: "definition" }),
];

/** Extensions needed for a view with fenced div parsing + plugin registry. */
function pickerExtensions(plugins = standardPlugins) {
  return [
    markdown({ extensions: markdownExtensions }),
    frontmatterField,
    createPluginRegistryField(plugins),
  ];
}

/** Track views created during tests for cleanup. */
const views: ReturnType<typeof createTestView>[] = [];

function makeView(doc: string, plugins = standardPlugins) {
  const view = createTestView(doc, {
    extensions: pickerExtensions(plugins),
  });
  views.push(view);
  return view;
}

function makePickerUiView(doc: string, plugins = standardPlugins) {
  const view = createTestView(doc, {
    extensions: [...pickerExtensions(plugins), blockTypePickerExtension],
  });
  views.push(view);
  return view;
}

function stubCoordsAtPos(view: EditorView): void {
  const rect = {
    x: 24,
    y: 48,
    width: 0,
    height: 18,
    top: 48,
    right: 24,
    bottom: 66,
    left: 24,
    toJSON() {
      return this;
    },
  } satisfies DOMRect;
  view.coordsAtPos = () => rect;
}

function triggerThirdColon(view: EditorView): boolean {
  const endPos = view.state.doc.length;
  view.dispatch({
    changes: { from: endPos, insert: "\n::" },
    selection: { anchor: endPos + 3 },
  });

  const from = view.state.selection.main.head;
  const handlers = view.state.facet(EditorView.inputHandler);
  const defaultInsert = () => view.state.update({
    changes: { from, to: from, insert: ":" },
    selection: { anchor: from + 1 },
    userEvent: "input.type",
  });
  const handled = handlers.some((handler) => handler(view, from, from, ":", defaultInsert));
  if (!handled) {
    view.dispatch(defaultInsert());
  }
  return handled;
}

function waitForTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  for (const v of views) v.destroy();
  views.length = 0;
});

// ===================================================================
// getPickerEntries
// ===================================================================

describe("getPickerEntries", () => {
  it("returns registered block types in manifest order", () => {
    const registry = registerPlugins(createRegistryState(), [
      makeBlockPlugin({ name: "proof", numbered: false }),
      makeBlockPlugin({ name: "theorem" }),
      makeBlockPlugin({ name: "definition" }),
    ]);

    const entries = getPickerEntries(registry);
    const names = entries.map((e) => e.name);

    // Manifest order: theorem, ..., definition, ..., proof, ...
    expect(names.indexOf("theorem")).toBeLessThan(names.indexOf("definition"));
    expect(names.indexOf("definition")).toBeLessThan(names.indexOf("proof"));
  });

  it("treats registered non-manifest names as ordinary custom blocks", () => {
    const registry = registerPlugins(createRegistryState(), [
      makeBlockPlugin({ name: "theorem" }),
      makeBlockPlugin({ name: "custom-widget" }),
      makeBlockPlugin({ name: "custom-panel" }),
    ]);

    const entries = getPickerEntries(registry);
    const names = entries.map((e) => e.name);

    expect(names).toContain("theorem");
    expect(names).toEqual(expect.arrayContaining(["custom-widget", "custom-panel"]));
  });

  it("includes custom frontmatter-defined plugins not in the manifest", () => {
    const registry = registerPlugins(createRegistryState(), [
      makeBlockPlugin({ name: "theorem" }),
      makeBlockPlugin({ name: "custom-block", title: "Custom Block" }),
    ]);

    const entries = getPickerEntries(registry);
    const names = entries.map((e) => e.name);

    expect(names).toContain("theorem");
    expect(names).toContain("custom-block");
    // Custom block goes after manifest entries
    expect(names.indexOf("theorem")).toBeLessThan(names.indexOf("custom-block"));
  });

  it("returns empty array when no plugins registered", () => {
    const registry = createRegistryState();
    const entries = getPickerEntries(registry);
    expect(entries).toEqual([]);
  });

  it("uses plugin title for the entry title", () => {
    const registry = registerPlugins(createRegistryState(), [
      makeBlockPlugin({ name: "theorem", title: "Theorem" }),
    ]);

    const entries = getPickerEntries(registry);
    const theoremTitle = entries.find((e) => e.name === "theorem")?.title;
    expect(theoremTitle).toBe("Theorem");
  });

  it("does not duplicate entries when a plugin matches both manifest and registry", () => {
    const registry = registerPlugins(createRegistryState(), [
      makeBlockPlugin({ name: "theorem" }),
    ]);

    const entries = getPickerEntries(registry);
    const theoremCount = entries.filter((e) => e.name === "theorem").length;
    expect(theoremCount).toBe(1);
  });
});

// ===================================================================
// insertBlock
// ===================================================================

describe("insertBlock", () => {
  it("inserts a basic block with ::: colons", () => {
    const view = makeView("some text\n\n");
    const insertPos = view.state.doc.length;

    insertBlock(view, insertPos, insertPos, "theorem");

    const result = view.state.doc.toString();
    expect(result).toContain("::: {.theorem}");
    // Should have opening fence, empty line, closing fence
    const lines = result.split("\n");
    const openIdx = lines.findIndex((l) => l.includes("::: {.theorem}"));
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(lines[openIdx + 1]).toBe(""); // empty content line
    expect(lines[openIdx + 2]).toBe(":::"); // closing fence
  });

  it("places cursor on the empty content line", () => {
    const view = makeView("");

    insertBlock(view, 0, 0, "theorem");

    const cursorPos = view.state.selection.main.anchor;
    // Cursor should be after `::: {.theorem}\n` = on the empty line
    const expectedPos = "::: {.theorem}".length + 1; // +1 for newline
    expect(cursorPos).toBe(expectedPos);
  });

  it("replaces the range [lineFrom, lineTo] with the block", () => {
    const view = makeView("line one\nplaceholder\nline three");
    const line2 = view.state.doc.line(2);

    insertBlock(view, line2.from, line2.to, "proof");

    const result = view.state.doc.toString();
    expect(result).not.toContain("placeholder");
    expect(result).toContain("::: {.proof}");
    expect(result).toContain("line one");
    expect(result).toContain("line three");
  });

  it("upgrades ancestor fences when inserting inside a ::: parent", () => {
    const view = makeView("::: {.theorem}\ncontent\n:::");

    // Simulate ancestor fences: parent uses 3 colons
    const ancestorFences = [{
      openFrom: 0,
      openTo: 3,
      closeFrom: 23,
      closeTo: 26,
      colons: 3,
    }];

    // Insert at the content position (after newline following opening fence)
    const contentLine = view.state.doc.line(2);
    insertBlock(view, contentLine.from, contentLine.to, "lemma", ancestorFences);

    const result = view.state.doc.toString();
    // Parent should be upgraded to 4 colons
    expect(result.startsWith("::::")).toBe(true);
    // New child should use 3 colons
    expect(result).toContain("::: {.lemma}");
    // Closing parent fence should also be upgraded
    expect(result.endsWith("::::")).toBe(true);
  });

  it("cascading upgrades for deeply nested blocks", () => {
    // Grandparent (4 colons) > parent (3 colons) > new child (3 colons)
    // Parent needs upgrading, then grandparent needs upgrading
    const doc = ":::: {.theorem}\n::: {.proof}\ninner\n:::\n::::";
    const view = makeView(doc, [
      makeBlockPlugin({ name: "theorem" }),
      makeBlockPlugin({ name: "proof", numbered: false }),
      makeBlockPlugin({ name: "lemma" }),
    ]);

    // Ancestor fences: [0] = direct parent (proof, 3 colons), [1] = grandparent (theorem, 4 colons)
    const ancestorFences = [
      { openFrom: 16, openTo: 19, closeFrom: 34, closeTo: 37, colons: 3 },
      { openFrom: 0, openTo: 4, closeFrom: 38, closeTo: 42, colons: 4 },
    ];

    // Insert inside the proof block (on the "inner" line)
    const innerLine = view.state.doc.line(3);
    insertBlock(view, innerLine.from, innerLine.to, "lemma", ancestorFences);

    const result = view.state.doc.toString();
    // Child uses 3 colons
    expect(result).toContain("::: {.lemma}");
    // Parent (proof) should be upgraded to 4 colons (> 3)
    expect(result).toContain(":::: {.proof}");
    // Grandparent (theorem) should be upgraded to 5 colons (> 4)
    expect(result).toContain("::::: {.theorem}");
  });

  it("does not upgrade ancestors that already have enough colons", () => {
    const doc = "::::: {.theorem}\ncontent\n:::::";
    const view = makeView(doc);

    // Ancestor with 5 colons, already more than 3
    const ancestorFences = [{
      openFrom: 0,
      openTo: 5,
      closeFrom: 25,
      closeTo: 30,
      colons: 5,
    }];

    const contentLine = view.state.doc.line(2);
    insertBlock(view, contentLine.from, contentLine.to, "lemma", ancestorFences);

    const result = view.state.doc.toString();
    // Ancestor should still have 5 colons (not upgraded further)
    expect(result.startsWith(":::::")).toBe(true);
    expect(result.startsWith("::::::")).toBe(false);
    // New block uses 3 colons
    expect(result).toContain("::: {.lemma}");
  });

  it("works with no ancestor fences (top level)", () => {
    const view = makeView("");

    insertBlock(view, 0, 0, "definition", []);

    const result = view.state.doc.toString();
    expect(result).toBe("::: {.definition}\n\n:::");
  });

  it("works with undefined ancestor fences", () => {
    const view = makeView("");

    insertBlock(view, 0, 0, "remark");

    const result = view.state.doc.toString();
    expect(result).toBe("::: {.remark}\n\n:::");
  });
});

// ===================================================================
// collectAncestorFences
// ===================================================================

describe("collectAncestorFences", () => {
  it("returns empty array at top level", () => {
    const view = makeView("plain text\n");
    const fences = collectAncestorFences(view, 0);
    expect(fences).toEqual([]);
  });

  it("returns parent fence info when inside a FencedDiv", () => {
    const view = makeView("::: {.theorem}\ncontent\n:::");

    // Position inside the content (line 2)
    const contentLine = view.state.doc.line(2);
    const fences = collectAncestorFences(view, contentLine.from);

    expect(fences.length).toBe(1);
    expect(fences[0].openFrom).toBe(0);
    expect(fences[0].openTo).toBe(3);
    expect(fences[0].colons).toBe(3);
    // Closing fence should be present
    expect(fences[0].closeFrom).toBeGreaterThan(0);
    expect(fences[0].closeTo).toBeGreaterThan(fences[0].closeFrom);
  });

  it("returns multiple entries for deeply nested positions", () => {
    const doc = "::::: {.theorem}\n:::: {.proof}\n::: {.remark}\ncontent\n:::\n::::\n:::::";
    const view = makeView(doc, [
      makeBlockPlugin({ name: "theorem" }),
      makeBlockPlugin({ name: "proof", numbered: false }),
      makeBlockPlugin({ name: "remark", numbered: false }),
    ]);

    // Position inside the innermost block (content line)
    const contentLine = view.state.doc.line(4);
    const fences = collectAncestorFences(view, contentLine.from);

    expect(fences.length).toBe(3);
    expect(fences[0].colons).toBe(3); // remark (innermost)
    expect(fences[1].colons).toBe(4); // proof
    expect(fences[2].colons).toBe(5); // theorem (outermost)
  });

  it("reports correct colon count for fences", () => {
    const view = makeView(":::: {.theorem}\ncontent\n::::");

    const contentLine = view.state.doc.line(2);
    const fences = collectAncestorFences(view, contentLine.from);

    expect(fences.length).toBe(1);
    expect(fences[0].colons).toBe(4);
  });

  it("reports closeFrom as -1 when closing fence is missing", () => {
    // Unclosed fenced div -- parser may produce a FencedDiv without a close fence
    const view = makeView("::: {.theorem}\ncontent");

    const contentLine = view.state.doc.line(2);
    const fences = collectAncestorFences(view, contentLine.from);

    // The parser may or may not produce a FencedDiv for an unclosed fence.
    // If it does, closeFrom should be -1.
    if (fences.length > 0) {
      expect(fences[0].closeFrom).toBe(-1);
      expect(fences[0].closeTo).toBe(-1);
    }
  });
});

// ===================================================================
// picker UI
// ===================================================================

describe("picker UI", () => {
  it("opens a cmdk picker on ::: trigger and dismisses on Escape", async () => {
    const view = makePickerUiView("");
    stubCoordsAtPos(view);

    const handled = triggerThirdColon(view);
    expect(handled).toBe(true);

    await waitForTick();

    expect(isPickerVisible()).toBe(true);
    const picker = document.querySelector(".cf-block-picker");
    expect(picker).not.toBeNull();
    expect(picker?.querySelector("[cmdk-root]")).not.toBeNull();
    expect(picker?.querySelectorAll(".cf-block-picker-item").length).toBeGreaterThan(0);

    const input = picker?.querySelector(".cf-block-picker-input") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    await waitForTick();

    expect(isPickerVisible()).toBe(false);
  });

  it("closes cleanly when picker coordinates are unavailable", async () => {
    const view = makePickerUiView("");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    view.coordsAtPos = () => null;

    try {
      const handled = triggerThirdColon(view);
      expect(handled).toBe(true);

      await waitForTick();

      expect(isPickerVisible()).toBe(false);
      const picker = document.querySelector(".cf-block-picker");
      expect(picker?.querySelector("[cmdk-root]")).toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("resets picker state across rapid reopen", async () => {
    const firstView = makePickerUiView("");
    const secondView = makePickerUiView("");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    stubCoordsAtPos(firstView);
    stubCoordsAtPos(secondView);

    try {
      expect(triggerThirdColon(firstView)).toBe(true);
      await waitForTick();

      const picker = document.querySelector(".cf-block-picker");
      const firstInput = picker?.querySelector(".cf-block-picker-input") as HTMLInputElement | null;
      expect(firstInput).not.toBeNull();
      if (!firstInput) throw new Error("expected the first picker input to exist");
      firstInput.value = "zzz";
      firstInput.dispatchEvent(new Event("input", { bubbles: true }));
      await waitForTick();
      expect(firstInput?.value).toBe("zzz");

      expect(triggerThirdColon(secondView)).toBe(true);
      await waitForTick();

      const reopenedPicker = document.querySelector(".cf-block-picker");
      const reopenedInput = reopenedPicker?.querySelector(
        ".cf-block-picker-input",
      ) as HTMLInputElement | null;
      expect(reopenedInput).not.toBeNull();
      expect(reopenedInput?.value).toBe("");
      expect(document.querySelectorAll("[cmdk-root]")).toHaveLength(1);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
