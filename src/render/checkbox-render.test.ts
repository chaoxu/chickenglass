import { markdown } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";
import {
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownExtensions } from "../parser";
import {
  createTestView,
  getDecorationSpecs,
} from "../test-utils";
import {
  CheckboxWidget,
  checkboxRenderPlugin,
  _checkboxDecorationFieldForTest as checkboxDecorationField,
} from "./checkbox-render";

let view: EditorView | undefined;

interface CheckboxPluginProbe {
  decorations: DecorationSet;
}

function getCheckboxPlugin(): CheckboxPluginProbe {
  if (!view) {
    throw new Error("expected checkbox render view");
  }
  return { decorations: view.state.field(checkboxDecorationField) };
}

function createCheckboxView(doc: string, cursorPos: number): CheckboxPluginProbe {
  view = createTestView(doc, {
    cursorPos,
    extensions: [markdown({ extensions: markdownExtensions }), checkboxRenderPlugin],
  });
  forceParsing(view, view.state.doc.length, 5000);
  const plugin = getCheckboxPlugin();
  // Warm up the first dispatch after construction to clear JSDOM's spurious
  // focusChanged signal before each assertion inspects rebuild behavior.
  view.dispatch({ selection: { anchor: cursorPos } });
  return plugin;
}

afterEach(() => {
  view?.destroy();
  view = undefined;
});

describe("CheckboxWidget", () => {
  describe("toDOM", () => {
    it("produces an input[type=checkbox]", () => {
      view = createTestView("- [ ] task");
      const widget = new CheckboxWidget(false, 2, 5);
      const el = widget.toDOM(view);
      expect(el.tagName).toBe("INPUT");
      expect(el.getAttribute("type")).toBe("checkbox");
    });

    it("sets checked=true for a checked widget", () => {
      view = createTestView("- [x] task");
      const widget = new CheckboxWidget(true, 2, 5);
      const el = widget.toDOM(view) as HTMLInputElement;
      expect(el.checked).toBe(true);
    });

    it("sets checked=false for an unchecked widget", () => {
      view = createTestView("- [ ] task");
      const widget = new CheckboxWidget(false, 2, 5);
      const el = widget.toDOM(view) as HTMLInputElement;
      expect(el.checked).toBe(false);
    });
  });

  describe("eq", () => {
    it("returns true when checked, from, and to all match", () => {
      const a = new CheckboxWidget(true, 10, 13);
      const b = new CheckboxWidget(true, 10, 13);
      expect(a.eq(b)).toBe(true);
    });

    // Regression: eq() must compare `to` so a document edit that shifts the
    // closing marker (without changing `from`) causes the widget to re-render
    // with the correct replacement range. Omitting `to` would leave the widget
    // toggling the wrong character range after the edit. See #346.
    it("returns false when to differs (same from and checked)", () => {
      const a = new CheckboxWidget(true, 10, 13);
      const b = new CheckboxWidget(true, 10, 15);
      expect(a.eq(b)).toBe(false);
    });

    it("returns false when checked differs", () => {
      const a = new CheckboxWidget(true, 10, 13);
      const b = new CheckboxWidget(false, 10, 13);
      expect(a.eq(b)).toBe(false);
    });

    it("returns false when from differs", () => {
      const a = new CheckboxWidget(true, 10, 13);
      const b = new CheckboxWidget(true, 20, 23);
      expect(a.eq(b)).toBe(false);
    });

    it("returns false when both checked and from differ", () => {
      const a = new CheckboxWidget(true, 10, 13);
      const b = new CheckboxWidget(false, 20, 23);
      expect(a.eq(b)).toBe(false);
    });

    describe("negative / edge-case", () => {
      it("returns false when compared against widget at position 0 vs non-zero", () => {
        const a = new CheckboxWidget(false, 0, 3);
        const b = new CheckboxWidget(false, 1, 4);
        expect(a.eq(b)).toBe(false);
      });

      it("returns false when to is 0 vs non-zero even with same from and checked", () => {
        const a = new CheckboxWidget(true, 5, 0);
        const b = new CheckboxWidget(true, 5, 8);
        expect(a.eq(b)).toBe(false);
      });
    });
  });

  describe("negative / edge-case (toDOM)", () => {
    it("toDOM creates unchecked checkbox for position 0,0", () => {
      view = createTestView("- [ ] task");
      const widget = new CheckboxWidget(false, 0, 0);
      const el = widget.toDOM(view) as HTMLInputElement;
      expect(el.checked).toBe(false);
    });
  });
});

describe("checkboxRenderPlugin stable task markers", () => {
  it("maps checkbox widgets through unrelated prose edits", () => {
    const doc = "plain text\n\n- [ ] task";
    const prosePos = doc.indexOf("plain") + 2;
    const plugin = createCheckboxView(doc, prosePos);
    const before = getDecorationSpecs(plugin.decorations);

    view?.dispatch({
      changes: { from: prosePos, to: prosePos, insert: "ZZ" },
      selection: { anchor: prosePos + 2 },
    });

    const after = getDecorationSpecs(getCheckboxPlugin().decorations);
    expect(after).toHaveLength(1);
    expect(after[0]?.widgetClass).toBe("CheckboxWidget");
    expect(after[0]?.from).toBe((before[0]?.from ?? 0) + 2);
    expect(after[0]?.to).toBe((before[0]?.to ?? 0) + 2);
  });

  it("toggles the mapped task marker after unrelated prose edits", () => {
    const doc = "plain text\n\n- [ ] task";
    const prosePos = doc.indexOf("plain") + 2;
    createCheckboxView(doc, prosePos);

    view?.dispatch({
      changes: { from: prosePos, to: prosePos, insert: "ZZ" },
      selection: { anchor: prosePos + 2 },
    });

    const input = view?.dom.querySelector<HTMLInputElement>('input[type="checkbox"]');
    input?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(view?.state.doc.toString()).toBe("plZZain text\n\n- [x] task");
  });

  it("recovers task markers when the parser catches up during unrelated prose edits", () => {
    const doc = "plain text\n\n- [ ] task";
    const prosePos = doc.indexOf("plain") + 2;
    createCheckboxView(doc, prosePos);

    view?.dispatch({
      changes: { from: prosePos, to: prosePos, insert: "ZZ" },
      selection: { anchor: prosePos + 2 },
    });

    const after = getDecorationSpecs(getCheckboxPlugin().decorations);
    expect(after).toHaveLength(1);
    expect(after[0]?.widgetClass).toBe("CheckboxWidget");
  });

  it("does not rebuild when the cursor moves through plain prose", () => {
    const doc = "- [ ] task\n\nplain text";
    const prosePos = doc.indexOf("plain") + 2;
    const plugin = createCheckboxView(doc, prosePos);
    const before = plugin.decorations;

    view?.dispatch({ selection: { anchor: prosePos + 2 } });

    const after = getCheckboxPlugin().decorations;
    expect(after).toBe(before);
    expect(getDecorationSpecs(after)).toHaveLength(1);
  });

  it("keeps the checkbox widget rendered when the cursor enters the marker", () => {
    createCheckboxView("- [ ] task", 3);
    view?.dispatch({ selection: { anchor: 6 } });

    expect(getDecorationSpecs(getCheckboxPlugin().decorations)).toHaveLength(1);
  });

  it("keeps one widget per task marker when the cursor moves between markers", () => {
    const doc = "- [ ] first\n- [x] second";
    const secondMarkerPos = doc.lastIndexOf("[") + 1;
    createCheckboxView(doc, 3);

    view?.dispatch({ selection: { anchor: secondMarkerPos } });

    expect(getDecorationSpecs(getCheckboxPlugin().decorations)).toHaveLength(2);
  });
});
