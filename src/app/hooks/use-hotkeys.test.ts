import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type HotkeyBinding, useHotkeys } from "./use-hotkeys";

function modKeyInit(): KeyboardEventInit {
  return navigator.platform.toLowerCase().startsWith("mac")
    ? { metaKey: true }
    : { ctrlKey: true };
}

function Harness({ bindings }: { bindings: HotkeyBinding[] }): null {
  useHotkeys(bindings);
  return null;
}

describe("useHotkeys", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted = false;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = (globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (mounted) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    vi.restoreAllMocks();
    mounted = false;
  });

  async function render(bindings: HotkeyBinding[]): Promise<void> {
    await act(async () => {
      root.render(createElement(Harness, { bindings }));
      await Promise.resolve();
    });
    mounted = true;
  }

  function unmount(): void {
    act(() => {
      root.unmount();
    });
    mounted = false;
  }

  function dispatchKeydown(
    target: EventTarget,
    key: string,
    init: KeyboardEventInit = {},
  ): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }));
    });
  }

  it("matches mod bindings case-insensitively", async () => {
    const handler = vi.fn();

    await render([{ key: "mod+s", handler }]);
    dispatchKeydown(document, "S", modKeyInit());

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not match when extra modifiers are held", async () => {
    const handler = vi.fn();

    await render([{ key: "mod+s", handler }]);
    dispatchKeydown(document, "s", {
      ...modKeyInit(),
      shiftKey: true,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not match when the opposite platform modifier is also held", async () => {
    const handler = vi.fn();

    await render([{ key: "mod+s", handler }]);
    dispatchKeydown(document, "s", {
      ...modKeyInit(),
      ctrlKey: true,
      metaKey: true,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("blocks shortcuts from inputs by default", async () => {
    const handler = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);

    await render([{ key: "Escape", handler }]);
    dispatchKeydown(input, "Escape");

    expect(handler).not.toHaveBeenCalled();
  });

  it("allows shortcuts from editable targets when opted in", async () => {
    const handler = vi.fn();
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.appendChild(editable);

    await render([{ key: "Escape", handler, allowInInputs: true }]);
    dispatchKeydown(editable, "Escape");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("uses the latest bindings after rerender", async () => {
    const first = vi.fn();
    const second = vi.fn();

    await render([{ key: "Escape", handler: first }]);
    await render([{ key: "Enter", handler: second }]);

    dispatchKeydown(document, "Escape");
    dispatchKeydown(document, "Enter");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on unmount", async () => {
    const handler = vi.fn();

    await render([{ key: "Escape", handler }]);
    unmount();
    dispatchKeydown(document, "Escape");

    expect(handler).not.toHaveBeenCalled();
  });
});
