import { describe, expect, it } from "vitest";

import { TabBar } from "./tab-bar";

describe("TabBar", () => {
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

});
