import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBar } from "./status-bar";

describe("StatusBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not render a save label for the idle empty-editor state", () => {
    act(() => {
      root.render(createElement(StatusBar, {
        editorMode: "cm6-rich",
        onModeChange: vi.fn(),
        saveStatus: "idle",
      }));
    });

    expect(container.querySelector("[data-testid='save-status']")).toBeNull();
    expect(container.textContent).not.toContain("Saved");
  });

  it("renders failed save details as the save status tooltip", () => {
    act(() => {
      root.render(createElement(StatusBar, {
        editorMode: "cm6-rich",
        onModeChange: vi.fn(),
        saveStatus: "failed",
        saveStatusMessage: "disk full",
      }));
    });

    const saveStatus = container.querySelector("[data-testid='save-status']");
    expect(saveStatus?.textContent).toBe("Failed");
    expect(saveStatus?.getAttribute("title")).toBe("disk full");
  });

  it("exposes a stable mode-switch button for browser harnesses", () => {
    const onModeChange = vi.fn();

    act(() => {
      root.render(createElement(StatusBar, {
        editorMode: "cm6-rich",
        onModeChange,
        saveStatus: "idle",
      }));
    });

    const modeButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='mode-button']",
    );

    expect(modeButton).not.toBeNull();
    expect(modeButton?.getAttribute("aria-label")).toContain("Editor mode: CM6 Rich");

    act(() => {
      modeButton?.click();
    });
    expect(onModeChange).toHaveBeenCalledWith("source");
  });

  it("advertises the documented command palette shortcut", () => {
    act(() => {
      root.render(createElement(StatusBar, {
        editorMode: "cm6-rich",
        onModeChange: vi.fn(),
        onOpenPalette: vi.fn(),
        saveStatus: "idle",
      }));
    });

    const paletteButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='command-palette-button']",
    );

    expect(paletteButton?.getAttribute("aria-label")).toBe("Command Palette (⌘P)");
  });
});
