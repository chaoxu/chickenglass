import { describe, expect, it, vi } from "vitest";

import { TabBar } from "./tab-bar";

describe("TabBar", () => {
  it("creates an element", () => {
    const bar = new TabBar();
    expect(bar.element).toBeInstanceOf(HTMLElement);
    expect(bar.element.className).toBe("tab-bar");
  });

  it("opens and tracks tabs", () => {
    const bar = new TabBar();
    bar.openTab("a.md", "a.md");
    bar.openTab("b.md", "b.md");
    expect(bar.hasTab("a.md")).toBe(true);
    expect(bar.hasTab("b.md")).toBe(true);
    expect(bar.hasTab("c.md")).toBe(false);
  });

  it("sets the active tab on open", () => {
    const bar = new TabBar();
    bar.openTab("a.md", "a.md");
    bar.openTab("b.md", "b.md");
    expect(bar.getActiveTab()).toBe("b.md");
  });

  it("does not duplicate tabs on re-open", () => {
    const bar = new TabBar();
    bar.openTab("a.md", "a.md");
    bar.openTab("a.md", "a.md");
    expect(bar.getOpenTabs()).toHaveLength(1);
  });

  it("closes a tab and returns the next active", () => {
    const bar = new TabBar();
    bar.openTab("a.md", "a.md");
    bar.openTab("b.md", "b.md");
    bar.openTab("c.md", "c.md");

    const next = bar.closeTab("b.md");
    expect(bar.hasTab("b.md")).toBe(false);
    expect(next).toBe("c.md"); // active stays on c.md
  });

  it("activates the previous tab when closing the active tab", () => {
    const bar = new TabBar();
    bar.openTab("a.md", "a.md");
    bar.openTab("b.md", "b.md");

    // b.md is active, close it
    const next = bar.closeTab("b.md");
    expect(next).toBe("a.md");
  });

  it("returns null when closing the last tab", () => {
    const bar = new TabBar();
    bar.openTab("a.md", "a.md");
    const next = bar.closeTab("a.md");
    expect(next).toBeNull();
  });

  it("marks tabs as dirty", () => {
    const bar = new TabBar();
    bar.openTab("a.md", "a.md");
    bar.setDirty("a.md", true);

    const tab = bar.getOpenTabs().find((t) => t.path === "a.md");
    expect(tab?.dirty).toBe(true);
  });

  it("renders dirty indicator in DOM", () => {
    const bar = new TabBar();
    bar.openTab("a.md", "a.md");
    bar.setDirty("a.md", true);

    const dirty = bar.element.querySelector(".tab-dirty");
    expect(dirty).not.toBeNull();
  });

  it("calls select handler on tab click", () => {
    const bar = new TabBar();
    const handler = vi.fn();
    bar.setSelectHandler(handler);
    bar.openTab("a.md", "a.md");

    const tabEl = bar.element.querySelector(".tab");
    (tabEl as HTMLElement)?.click();
    expect(handler).toHaveBeenCalledWith("a.md");
  });

  it("calls close handler on close button click", () => {
    const bar = new TabBar();
    const handler = vi.fn();
    bar.setCloseHandler(handler);
    bar.openTab("a.md", "a.md");

    const closeBtn = bar.element.querySelector(".tab-close");
    (closeBtn as HTMLElement)?.click();
    expect(handler).toHaveBeenCalledWith("a.md");
  });
});
