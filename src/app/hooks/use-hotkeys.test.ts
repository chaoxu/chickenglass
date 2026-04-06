import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type HotkeyBinding, useHotkeys } from "./use-hotkeys";

function modKeyInit(): KeyboardEventInit {
  return navigator.platform.toLowerCase().startsWith("mac")
    ? { metaKey: true }
    : { ctrlKey: true };
}

describe("useHotkeys", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function dispatchKeydown(
    target: EventTarget,
    key: string,
    init: KeyboardEventInit = {},
  ): void {
    target.dispatchEvent(new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }));
  }

  it("matches mod bindings case-insensitively", () => {
    const handler = vi.fn();

    renderHook(({ bindings }: { bindings: HotkeyBinding[] }) => useHotkeys(bindings), {
      initialProps: { bindings: [{ key: "mod+s", handler }] },
    });
    dispatchKeydown(document, "S", modKeyInit());

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not match when extra modifiers are held", () => {
    const handler = vi.fn();

    renderHook(({ bindings }: { bindings: HotkeyBinding[] }) => useHotkeys(bindings), {
      initialProps: { bindings: [{ key: "mod+s", handler }] },
    });
    dispatchKeydown(document, "s", {
      ...modKeyInit(),
      shiftKey: true,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not match when the opposite platform modifier is also held", () => {
    const handler = vi.fn();

    renderHook(({ bindings }: { bindings: HotkeyBinding[] }) => useHotkeys(bindings), {
      initialProps: { bindings: [{ key: "mod+s", handler }] },
    });
    dispatchKeydown(document, "s", {
      ...modKeyInit(),
      ctrlKey: true,
      metaKey: true,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("blocks shortcuts from inputs by default", () => {
    const handler = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);

    renderHook(({ bindings }: { bindings: HotkeyBinding[] }) => useHotkeys(bindings), {
      initialProps: { bindings: [{ key: "Escape", handler }] },
    });
    dispatchKeydown(input, "Escape");

    expect(handler).not.toHaveBeenCalled();
  });

  it("allows shortcuts from editable targets when opted in", () => {
    const handler = vi.fn();
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.appendChild(editable);

    renderHook(({ bindings }: { bindings: HotkeyBinding[] }) => useHotkeys(bindings), {
      initialProps: { bindings: [{ key: "Escape", handler, allowInInputs: true }] },
    });
    dispatchKeydown(editable, "Escape");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("uses the latest bindings after rerender", () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ bindings }: { bindings: HotkeyBinding[] }) => useHotkeys(bindings),
      { initialProps: { bindings: [{ key: "Escape", handler: first }] } },
    );
    rerender({ bindings: [{ key: "Enter", handler: second }] });

    dispatchKeydown(document, "Escape");
    dispatchKeydown(document, "Enter");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on unmount", () => {
    const handler = vi.fn();

    const { unmount } = renderHook(
      ({ bindings }: { bindings: HotkeyBinding[] }) => useHotkeys(bindings),
      { initialProps: { bindings: [{ key: "Escape", handler }] } },
    );
    unmount();
    dispatchKeydown(document, "Escape");

    expect(handler).not.toHaveBeenCalled();
  });
});
