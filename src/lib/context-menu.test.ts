import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextMenu } from "./context-menu";

function getRenderedMenu() {
  return document.querySelector(".cf-imperative-context-menu-content");
}

function getRenderedItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".cf-imperative-context-menu-item"),
  );
}

describe("ContextMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders separators and executes enabled item actions", async () => {
    const enabledAction = vi.fn();
    const disabledAction = vi.fn();

    const menu = new ContextMenu(
      [
        { label: "Insert Row Above", action: enabledAction },
        { label: "-" },
        { label: "Delete Row", disabled: true, action: disabledAction },
      ],
      24,
      48,
    );

    await vi.waitFor(() => {
      expect(getRenderedMenu()).not.toBeNull();
    });

    const items = getRenderedItems();
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Insert Row Above",
      "Delete Row",
    ]);
    expect(document.querySelectorAll(".cf-imperative-context-menu-separator")).toHaveLength(1);
    expect(items[1]?.hasAttribute("data-disabled")).toBe(true);

    await act(async () => {
      items[0]?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });

    expect(enabledAction).toHaveBeenCalledTimes(1);
    expect(disabledAction).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(getRenderedMenu()).toBeNull();
    });

    menu.dismiss();
  });

  it("dismisses on Escape and keeps dismiss idempotent", async () => {
    const menu = new ContextMenu([{ label: "Close" }], 8, 16);

    await vi.waitFor(() => {
      expect(getRenderedMenu()).not.toBeNull();
    });

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });

    await vi.waitFor(() => {
      expect(getRenderedMenu()).toBeNull();
    });

    menu.dismiss();
    menu.dismiss();

    expect(document.querySelector(".cf-imperative-context-menu-trigger")).toBeNull();
  });
});
