import { describe, expect, it } from "vitest";
import { RenderWidget } from "./source-widget";
import { ShellWidget } from "./shell-widget";

class TestSourceWidget extends RenderWidget {
  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  eq(other: TestSourceWidget): boolean {
    return other instanceof TestSourceWidget;
  }
}

class TestShellWidget extends ShellWidget {
  createDOM(): HTMLElement {
    return document.createElement("div");
  }

  eq(other: TestShellWidget): boolean {
    return other instanceof TestShellWidget;
  }
}

describe("ShellWidget", () => {
  it("adds shell-surface attrs on top of source attrs", () => {
    const widget = new TestShellWidget();
    widget.updateSourceRange(12, 24);

    const el = widget.toDOM();

    expect(el.dataset.sourceFrom).toBe("12");
    expect(el.dataset.sourceTo).toBe("24");
    expect(el.dataset.shellFrom).toBe("12");
    expect(el.dataset.shellTo).toBe("24");
  });

  it("keeps ordinary source-bound widgets out of shell measurement", () => {
    const widget = new TestSourceWidget();
    widget.updateSourceRange(5, 9);

    const el = widget.toDOM();

    expect(el.dataset.sourceFrom).toBe("5");
    expect(el.dataset.sourceTo).toBe("9");
    expect(el.dataset.shellFrom).toBeUndefined();
    expect(el.dataset.shellTo).toBeUndefined();
  });
});
