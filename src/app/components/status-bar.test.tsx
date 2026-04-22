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
});
