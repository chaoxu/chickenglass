import { describe, expect, it } from "vitest";

import type { BlockPlugin } from "./plugin-types";
import {
  createRegistryState,
  registerPlugin,
  registerPlugins,
  unregisterPlugin,
  getPlugin,
  getRegisteredNames,
  pluginFromConfig,
  applyFrontmatterBlocks,
} from "./plugin-registry";

/** Helper to make a minimal plugin for testing. */
function makePlugin(overrides: Partial<BlockPlugin> & { name: string }): BlockPlugin {
  return {
    numbered: true,
    title: overrides.name.charAt(0).toUpperCase() + overrides.name.slice(1),
    render: (attrs) => ({
      className: `cg-block cg-block-${attrs.type}`,
      header: `${overrides.title ?? overrides.name} ${attrs.number ?? ""}`.trim(),
    }),
    ...overrides,
  };
}

describe("createRegistryState", () => {
  it("creates an empty registry", () => {
    const state = createRegistryState();
    expect(state.plugins.size).toBe(0);
  });
});

describe("registerPlugin", () => {
  it("adds a plugin to the registry", () => {
    const state = createRegistryState();
    const plugin = makePlugin({ name: "theorem" });
    const next = registerPlugin(state, plugin);
    expect(getPlugin(next, "theorem")).toBe(plugin);
  });

  it("does not mutate the original state", () => {
    const state = createRegistryState();
    const plugin = makePlugin({ name: "theorem" });
    registerPlugin(state, plugin);
    expect(getPlugin(state, "theorem")).toBeUndefined();
  });

  it("overwrites a plugin with the same name", () => {
    const state = createRegistryState();
    const plugin1 = makePlugin({ name: "theorem", title: "Theorem" });
    const plugin2 = makePlugin({ name: "theorem", title: "Satz" });
    const next = registerPlugin(registerPlugin(state, plugin1), plugin2);
    expect(getPlugin(next, "theorem")?.title).toBe("Satz");
  });
});

describe("registerPlugins", () => {
  it("adds multiple plugins at once", () => {
    const state = createRegistryState();
    const plugins = [
      makePlugin({ name: "theorem" }),
      makePlugin({ name: "proof", numbered: false }),
    ];
    const next = registerPlugins(state, plugins);
    expect(getPlugin(next, "theorem")).toBeDefined();
    expect(getPlugin(next, "proof")).toBeDefined();
    expect(next.plugins.size).toBe(2);
  });
});

describe("unregisterPlugin", () => {
  it("removes a plugin by name", () => {
    let state = createRegistryState();
    state = registerPlugin(state, makePlugin({ name: "theorem" }));
    state = registerPlugin(state, makePlugin({ name: "proof" }));
    const next = unregisterPlugin(state, "theorem");
    expect(getPlugin(next, "theorem")).toBeUndefined();
    expect(getPlugin(next, "proof")).toBeDefined();
  });

  it("returns same state if plugin not found", () => {
    const state = createRegistryState();
    const next = unregisterPlugin(state, "nonexistent");
    expect(next).toBe(state);
  });

  it("does not mutate the original state", () => {
    let state = createRegistryState();
    state = registerPlugin(state, makePlugin({ name: "theorem" }));
    unregisterPlugin(state, "theorem");
    expect(getPlugin(state, "theorem")).toBeDefined();
  });
});

describe("getPlugin", () => {
  it("returns undefined for unknown names", () => {
    const state = createRegistryState();
    expect(getPlugin(state, "unknown")).toBeUndefined();
  });
});

describe("getRegisteredNames", () => {
  it("returns all registered names", () => {
    let state = createRegistryState();
    state = registerPlugins(state, [
      makePlugin({ name: "theorem" }),
      makePlugin({ name: "lemma" }),
      makePlugin({ name: "proof" }),
    ]);
    const names = getRegisteredNames(state);
    expect(names).toContain("theorem");
    expect(names).toContain("lemma");
    expect(names).toContain("proof");
    expect(names).toHaveLength(3);
  });
});

describe("pluginFromConfig", () => {
  it("creates a plugin with explicit title", () => {
    const plugin = pluginFromConfig("conjecture", {
      title: "Conjecture",
      counter: "theorem",
      numbered: true,
    });
    expect(plugin.name).toBe("conjecture");
    expect(plugin.title).toBe("Conjecture");
    expect(plugin.counter).toBe("theorem");
    expect(plugin.numbered).toBe(true);
  });

  it("defaults title to capitalized name", () => {
    const plugin = pluginFromConfig("remark", {});
    expect(plugin.title).toBe("Remark");
  });

  it("defaults numbered to true", () => {
    const plugin = pluginFromConfig("example", {});
    expect(plugin.numbered).toBe(true);
  });

  it("respects numbered=false", () => {
    const plugin = pluginFromConfig("proof", { numbered: false });
    expect(plugin.numbered).toBe(false);
  });

  it("provides a working render function", () => {
    const plugin = pluginFromConfig("theorem", { title: "Theorem" });
    const spec = plugin.render({
      type: "theorem",
      number: 3,
      title: "Main",
    });
    expect(spec.className).toBe("cg-block cg-block-theorem");
    expect(spec.header).toBe("Theorem 3 (Main)");
  });

  it("render omits number when undefined", () => {
    const plugin = pluginFromConfig("proof", {
      title: "Proof",
      numbered: false,
    });
    const spec = plugin.render({ type: "proof" });
    expect(spec.header).toBe("Proof");
  });

  it("render omits title suffix when no title", () => {
    const plugin = pluginFromConfig("theorem", { title: "Theorem" });
    const spec = plugin.render({ type: "theorem", number: 1 });
    expect(spec.header).toBe("Theorem 1");
  });
});

describe("applyFrontmatterBlocks", () => {
  it("adds plugins from BlockConfig entries", () => {
    const state = createRegistryState();
    const next = applyFrontmatterBlocks(state, {
      conjecture: { title: "Conjecture", counter: "theorem" },
    });
    const plugin = getPlugin(next, "conjecture");
    expect(plugin).toBeDefined();
    expect(plugin?.title).toBe("Conjecture");
    expect(plugin?.counter).toBe("theorem");
  });

  it("ignores true entries", () => {
    let state = createRegistryState();
    state = registerPlugin(state, makePlugin({ name: "theorem" }));
    const next = applyFrontmatterBlocks(state, { theorem: true });
    expect(getPlugin(next, "theorem")).toBeDefined();
  });

  it("removes plugins with false entries", () => {
    let state = createRegistryState();
    state = registerPlugin(state, makePlugin({ name: "theorem" }));
    const next = applyFrontmatterBlocks(state, { theorem: false });
    expect(getPlugin(next, "theorem")).toBeUndefined();
  });

  it("handles mixed entries", () => {
    let state = createRegistryState();
    state = registerPlugins(state, [
      makePlugin({ name: "theorem" }),
      makePlugin({ name: "proof" }),
    ]);
    const next = applyFrontmatterBlocks(state, {
      theorem: true,
      proof: false,
      remark: { title: "Remark", numbered: false },
    });
    expect(getPlugin(next, "theorem")).toBeDefined();
    expect(getPlugin(next, "proof")).toBeUndefined();
    expect(getPlugin(next, "remark")).toBeDefined();
    expect(getPlugin(next, "remark")?.numbered).toBe(false);
  });
});
