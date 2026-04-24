import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalConflictBanner } from "./external-conflict-banner";

describe("ExternalConflictBanner", () => {
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

  it("lets the user keep local edits for a modified disk file", async () => {
    const keepExternalConflict = vi.fn();
    const reloadFile = vi.fn(async () => {});

    await act(async () => {
      root.render(createElement(ExternalConflictBanner, {
        conflict: { kind: "modified", path: "notes/draft.md" },
        currentPath: "notes/draft.md",
        keepExternalConflict,
        mergeExternalConflict: vi.fn(),
        reloadFile,
        closeCurrentFile: vi.fn(async () => true),
      }));
    });

    expect(container.textContent).toContain(
      "\"draft.md\" changed on disk while you have local edits.",
    );

    const keepButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Keep edits");
    expect(keepButton).toBeDefined();

    await act(async () => {
      keepButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(keepExternalConflict).toHaveBeenCalledWith("notes/draft.md");
    expect(reloadFile).not.toHaveBeenCalled();
  });

  it("reloads from disk for a modified disk file", async () => {
    const reloadFile = vi.fn(async () => {});

    await act(async () => {
      root.render(createElement(ExternalConflictBanner, {
        conflict: { kind: "modified", path: "notes/draft.md" },
        currentPath: "notes/draft.md",
        keepExternalConflict: vi.fn(),
        mergeExternalConflict: vi.fn(),
        reloadFile,
        closeCurrentFile: vi.fn(async () => true),
      }));
    });

    const reloadButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Reload from disk");
    expect(reloadButton).toBeDefined();

    await act(async () => {
      reloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(reloadFile).toHaveBeenCalledWith("notes/draft.md");
  });

  it("lets the user merge modified disk changes into the editor", async () => {
    const mergeExternalConflict = vi.fn();

    await act(async () => {
      root.render(createElement(ExternalConflictBanner, {
        conflict: { kind: "modified", path: "notes/draft.md" },
        currentPath: "notes/draft.md",
        keepExternalConflict: vi.fn(),
        mergeExternalConflict,
        reloadFile: vi.fn(async () => {}),
        closeCurrentFile: vi.fn(async () => true),
      }));
    });

    const mergeButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Merge");
    expect(mergeButton).toBeDefined();

    await act(async () => {
      mergeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mergeExternalConflict).toHaveBeenCalledWith("notes/draft.md");
  });

  it("closes a dirty file that was deleted on disk", async () => {
    const closeCurrentFile = vi.fn(async () => true);

    await act(async () => {
      root.render(createElement(ExternalConflictBanner, {
        conflict: { kind: "deleted", path: "notes/draft.md" },
        currentPath: "notes/draft.md",
        keepExternalConflict: vi.fn(),
        mergeExternalConflict: vi.fn(),
        reloadFile: vi.fn(async () => {}),
        closeCurrentFile,
      }));
    });

    expect(container.textContent).toContain(
      "\"draft.md\" was deleted on disk while you have local edits.",
    );

    const closeButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Close file");
    expect(closeButton).toBeDefined();

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(closeCurrentFile).toHaveBeenCalledWith({ discard: true });
  });

  it("does not render for conflicts on another path", async () => {
    await act(async () => {
      root.render(createElement(ExternalConflictBanner, {
        conflict: { kind: "modified", path: "notes/draft.md" },
        currentPath: "notes/other.md",
        keepExternalConflict: vi.fn(),
        mergeExternalConflict: vi.fn(),
        reloadFile: vi.fn(async () => {}),
        closeCurrentFile: vi.fn(async () => true),
      }));
    });

    expect(container.textContent).toBe("");
  });
});
