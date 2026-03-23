import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { CheckboxWidget } from "./checkbox-render";
import { createTestView } from "../test-utils";

let view: EditorView | undefined;

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
  });
});
