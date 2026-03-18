import { describe, expect, it, vi } from "vitest";

import {
  CommandPalette,
  installPaletteKeybinding,
  type PaletteCommand,
} from "./command-palette";
import type { EditorView } from "@codemirror/view";

/** Create a minimal mock EditorView for testing. */
function mockView(): EditorView {
  return {
    focus: vi.fn(),
    state: {
      selection: { main: { from: 0, to: 0, head: 0 } },
      doc: { toString: () => "" },
      sliceDoc: () => "",
    },
    dispatch: vi.fn(),
    dom: document.createElement("div"),
  } as unknown as EditorView;
}

function makeCommand(
  overrides: Partial<PaletteCommand> & { id: string; label: string },
): PaletteCommand {
  return {
    action: vi.fn(),
    ...overrides,
  };
}

describe("CommandPalette", () => {
  it("creates an element with overlay structure", () => {
    const palette = new CommandPalette();
    expect(palette.element).toBeInstanceOf(HTMLElement);
    expect(palette.element.className).toBe("cmd-palette-overlay");
    expect(palette.element.querySelector(".cmd-palette-panel")).not.toBeNull();
    expect(
      palette.element.querySelector(".cmd-palette-backdrop"),
    ).not.toBeNull();
  });

  it("starts hidden", () => {
    const palette = new CommandPalette();
    expect(palette.isVisible()).toBe(false);
    expect(palette.element.style.display).toBe("none");
  });

  it("opens and closes", () => {
    const palette = new CommandPalette();
    const view = mockView();
    palette.setView(view);

    palette.open();
    expect(palette.isVisible()).toBe(true);
    expect(palette.element.style.display).toBe("");

    palette.close();
    expect(palette.isVisible()).toBe(false);
    expect(palette.element.style.display).toBe("none");
    expect(view.focus).toHaveBeenCalled();
  });

  it("toggles visibility", () => {
    const palette = new CommandPalette();
    palette.toggle();
    expect(palette.isVisible()).toBe(true);
    palette.toggle();
    expect(palette.isVisible()).toBe(false);
  });

  it("registers and lists commands", () => {
    const palette = new CommandPalette();
    const cmd = makeCommand({ id: "test", label: "Test Command" });
    palette.registerCommand(cmd);

    expect(palette.getCommands()).toHaveLength(1);
    expect(palette.getCommands()[0].id).toBe("test");
  });

  it("does not register duplicate commands", () => {
    const palette = new CommandPalette();
    const cmd = makeCommand({ id: "test", label: "Test Command" });
    palette.registerCommand(cmd);
    palette.registerCommand(cmd);

    expect(palette.getCommands()).toHaveLength(1);
  });

  it("registers multiple commands at once", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Alpha" }),
      makeCommand({ id: "b", label: "Beta" }),
    ]);

    expect(palette.getCommands()).toHaveLength(2);
  });

  it("shows all commands when query is empty", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Alpha" }),
      makeCommand({ id: "b", label: "Beta" }),
      makeCommand({ id: "c", label: "Gamma" }),
    ]);

    palette.open();
    expect(palette.getResultCount()).toBe(3);
  });

  it("filters commands by substring match", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Insert Theorem" }),
      makeCommand({ id: "b", label: "Insert Proof" }),
      makeCommand({ id: "c", label: "Toggle Focus Mode" }),
    ]);

    palette.open();
    palette.setQuery("theo");
    expect(palette.getResultCount()).toBe(1);
  });

  it("filter is case-insensitive", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Insert Theorem" }),
    ]);

    palette.open();
    palette.setQuery("THEOREM");
    expect(palette.getResultCount()).toBe(1);
  });

  it("renders command items in the results list", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Alpha", shortcut: "Cmd+A" }),
      makeCommand({ id: "b", label: "Beta" }),
    ]);

    palette.open();
    const items = palette.element.querySelectorAll(".cmd-palette-item");
    expect(items).toHaveLength(2);

    const firstLabel = items[0].querySelector(".cmd-palette-item-label");
    expect(firstLabel?.textContent).toBe("Alpha");

    const firstShortcut = items[0].querySelector(".cmd-palette-item-shortcut");
    expect(firstShortcut?.textContent).toBe("Cmd+A");

    // Second item has no shortcut
    const secondShortcut = items[1].querySelector(".cmd-palette-item-shortcut");
    expect(secondShortcut).toBeNull();
  });

  it("highlights the active item", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Alpha" }),
      makeCommand({ id: "b", label: "Beta" }),
    ]);

    palette.open();
    expect(palette.getActiveIndex()).toBe(0);

    const items = palette.element.querySelectorAll(".cmd-palette-item");
    expect(items[0].classList.contains("cmd-palette-item-active")).toBe(true);
    expect(items[1].classList.contains("cmd-palette-item-active")).toBe(false);
  });

  it("navigates with ArrowDown", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Alpha" }),
      makeCommand({ id: "b", label: "Beta" }),
    ]);

    palette.open();
    const panel = palette.element.querySelector(
      ".cmd-palette-panel",
    ) as HTMLElement;

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(palette.getActiveIndex()).toBe(1);

    // Wraps around
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(palette.getActiveIndex()).toBe(0);
  });

  it("navigates with ArrowUp", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Alpha" }),
      makeCommand({ id: "b", label: "Beta" }),
    ]);

    palette.open();
    const panel = palette.element.querySelector(
      ".cmd-palette-panel",
    ) as HTMLElement;

    // Wraps to last item
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(palette.getActiveIndex()).toBe(1);

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(palette.getActiveIndex()).toBe(0);
  });

  it("executes command on Enter", () => {
    const palette = new CommandPalette();
    const view = mockView();
    palette.setView(view);

    const action = vi.fn();
    palette.registerCommand(makeCommand({ id: "a", label: "Alpha", action }));

    palette.open();
    const panel = palette.element.querySelector(
      ".cmd-palette-panel",
    ) as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(action).toHaveBeenCalledWith(view);
    expect(palette.isVisible()).toBe(false);
  });

  it("executes command on click", () => {
    const palette = new CommandPalette();
    const view = mockView();
    palette.setView(view);

    const action = vi.fn();
    palette.registerCommand(makeCommand({ id: "a", label: "Alpha", action }));

    palette.open();
    const item = palette.element.querySelector(
      ".cmd-palette-item",
    ) as HTMLElement;
    item.click();

    expect(action).toHaveBeenCalledWith(view);
    expect(palette.isVisible()).toBe(false);
  });

  it("closes on Escape", () => {
    const palette = new CommandPalette();
    palette.open();

    const panel = palette.element.querySelector(
      ".cmd-palette-panel",
    ) as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(palette.isVisible()).toBe(false);
  });

  it("closes on backdrop click", () => {
    const palette = new CommandPalette();
    palette.open();

    const backdrop = palette.element.querySelector(
      ".cmd-palette-backdrop",
    ) as HTMLElement;
    backdrop.click();

    expect(palette.isVisible()).toBe(false);
  });

  it("resets query and active index on open", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Alpha" }),
      makeCommand({ id: "b", label: "Beta" }),
    ]);

    palette.open();
    palette.setQuery("beta");
    expect(palette.getResultCount()).toBe(1);

    palette.close();
    palette.open();

    expect(palette.getQuery()).toBe("");
    expect(palette.getActiveIndex()).toBe(0);
    expect(palette.getResultCount()).toBe(2);
  });

  it("includes dynamic commands when opened", () => {
    const palette = new CommandPalette();
    palette.registerCommand(makeCommand({ id: "static", label: "Static" }));
    palette.setDynamicProvider(() => [
      makeCommand({ id: "dynamic-1", label: "Go to Introduction" }),
      makeCommand({ id: "dynamic-2", label: "Go to Conclusion" }),
    ]);

    palette.open();
    expect(palette.getResultCount()).toBe(3);
  });

  it("updates active highlight on mouseenter", () => {
    const palette = new CommandPalette();
    palette.registerCommands([
      makeCommand({ id: "a", label: "Alpha" }),
      makeCommand({ id: "b", label: "Beta" }),
    ]);

    palette.open();
    const items = palette.element.querySelectorAll(".cmd-palette-item");
    items[1].dispatchEvent(new MouseEvent("mouseenter"));

    expect(palette.getActiveIndex()).toBe(1);
    expect(items[1].classList.contains("cmd-palette-item-active")).toBe(true);
    expect(items[0].classList.contains("cmd-palette-item-active")).toBe(false);
  });
});

describe("installPaletteKeybinding", () => {
  it("toggles palette on Cmd+P", () => {
    const root = document.createElement("div");
    const palette = new CommandPalette();
    installPaletteKeybinding(root, palette);

    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", metaKey: true }),
    );
    expect(palette.isVisible()).toBe(true);

    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", metaKey: true }),
    );
    expect(palette.isVisible()).toBe(false);
  });

  it("toggles palette on Ctrl+P", () => {
    const root = document.createElement("div");
    const palette = new CommandPalette();
    installPaletteKeybinding(root, palette);

    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", ctrlKey: true }),
    );
    expect(palette.isVisible()).toBe(true);
  });

  it("does not toggle on Cmd+Shift+P", () => {
    const root = document.createElement("div");
    const palette = new CommandPalette();
    installPaletteKeybinding(root, palette);

    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        metaKey: true,
        shiftKey: true,
      }),
    );
    expect(palette.isVisible()).toBe(false);
  });

  it("returns a cleanup function", () => {
    const root = document.createElement("div");
    const palette = new CommandPalette();
    const cleanup = installPaletteKeybinding(root, palette);

    cleanup();

    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", metaKey: true }),
    );
    expect(palette.isVisible()).toBe(false);
  });
});
