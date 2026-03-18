import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { frontmatterField } from "../editor/frontmatter-state";
import { projectConfigFacet } from "../app/project-config";
import type { BlockConfig } from "../parser/frontmatter";

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
  pluginRegistryField,
  createPluginRegistryField,
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

// ---------------------------------------------------------------------------
// CM6 StateField integration: declarative block plugins from YAML
// ---------------------------------------------------------------------------

/** Default plugins used in CM6 integration tests. */
const builtinTestPlugins: readonly BlockPlugin[] = [
  makePlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
  makePlugin({ name: "lemma", counter: "theorem", title: "Lemma" }),
  makePlugin({ name: "proof", numbered: false, title: "Proof" }),
];

/** Create an EditorState with the plugin registry loaded from builtins. */
function createEditorState(doc: string, projectBlocks?: Record<string, boolean | BlockConfig>): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      ...(projectBlocks ? [projectConfigFacet.of({ blocks: projectBlocks })] : []),
      markdown({ extensions: [fencedDiv] }),
      frontmatterField,
      createPluginRegistryField(builtinTestPlugins),
    ],
  });
}

describe("createPluginRegistryField (CM6 integration)", () => {
  it("loads built-in plugins on creation", () => {
    const state = createEditorState("Hello world");
    const registry = state.field(pluginRegistryField);
    expect(getPlugin(registry, "theorem")).toBeDefined();
    expect(getPlugin(registry, "lemma")).toBeDefined();
    expect(getPlugin(registry, "proof")).toBeDefined();
    expect(registry.plugins.size).toBe(3);
  });

  it("applies frontmatter block definitions on creation", () => {
    const doc = [
      "---",
      "blocks:",
      "  claim:",
      "    counter: theorem",
      "    numbered: true",
      "    title: Claim",
      "---",
      "Content",
    ].join("\n");
    const state = createEditorState(doc);
    const registry = state.field(pluginRegistryField);
    // Built-in plugins still present
    expect(getPlugin(registry, "theorem")).toBeDefined();
    // Frontmatter-defined plugin added
    const claim = getPlugin(registry, "claim");
    expect(claim).toBeDefined();
    expect(claim?.title).toBe("Claim");
    expect(claim?.counter).toBe("theorem");
    expect(claim?.numbered).toBe(true);
  });

  it("frontmatter can disable built-in plugins", () => {
    const doc = [
      "---",
      "blocks:",
      "  proof: false",
      "---",
      "Content",
    ].join("\n");
    const state = createEditorState(doc);
    const registry = state.field(pluginRegistryField);
    expect(getPlugin(registry, "theorem")).toBeDefined();
    expect(getPlugin(registry, "proof")).toBeUndefined();
  });

  it("frontmatter can override built-in plugin properties", () => {
    const doc = [
      "---",
      "blocks:",
      "  theorem:",
      "    title: Satz",
      "    counter: theorem",
      "    numbered: true",
      "---",
      "Content",
    ].join("\n");
    const state = createEditorState(doc);
    const registry = state.field(pluginRegistryField);
    const theorem = getPlugin(registry, "theorem");
    expect(theorem?.title).toBe("Satz");
  });

  it("applies project-level block definitions", () => {
    const doc = "Content without frontmatter";
    const state = createEditorState(doc, {
      axiom: { counter: "theorem", numbered: true, title: "Axiom" },
    });
    const registry = state.field(pluginRegistryField);
    // Built-in plugins present
    expect(getPlugin(registry, "theorem")).toBeDefined();
    // Project-defined plugin available
    const axiom = getPlugin(registry, "axiom");
    expect(axiom).toBeDefined();
    expect(axiom?.title).toBe("Axiom");
    expect(axiom?.counter).toBe("theorem");
  });

  it("file frontmatter overrides project-level blocks", () => {
    const doc = [
      "---",
      "blocks:",
      "  axiom: false",
      "  claim:",
      "    counter: theorem",
      "    numbered: true",
      "    title: Claim",
      "---",
      "Content",
    ].join("\n");
    const state = createEditorState(doc, {
      axiom: { counter: "theorem", numbered: true, title: "Axiom" },
    });
    const registry = state.field(pluginRegistryField);
    // Project-defined axiom disabled by file frontmatter
    expect(getPlugin(registry, "axiom")).toBeUndefined();
    // File-defined claim present
    expect(getPlugin(registry, "claim")).toBeDefined();
  });

  it("declarative plugins share counter groups correctly", () => {
    const doc = "Content";
    const state = createEditorState(doc, {
      claim: { counter: "theorem", numbered: true, title: "Claim" },
      hypothesis: { counter: "theorem", numbered: true, title: "Hypothesis" },
    });
    const registry = state.field(pluginRegistryField);
    const claim = getPlugin(registry, "claim");
    const hypothesis = getPlugin(registry, "hypothesis");
    expect(claim?.counter).toBe("theorem");
    expect(hypothesis?.counter).toBe("theorem");
  });

  it("declarative plugins render with correct header format", () => {
    const doc = "Content";
    const state = createEditorState(doc, {
      claim: { counter: "theorem", numbered: true, title: "Claim" },
    });
    const registry = state.field(pluginRegistryField);
    const claim = getPlugin(registry, "claim");
    expect(claim).toBeDefined();
    if (!claim) throw new Error("claim plugin missing");
    const spec = claim.render({ type: "claim", number: 5, title: "Main" });
    expect(spec.header).toBe("Claim 5 (Main)");
    expect(spec.className).toBe("cg-block cg-block-claim");
  });

  it("rebuilds registry from defaults when frontmatter changes", () => {
    // Start with a custom block in frontmatter
    const initialDoc = [
      "---",
      "blocks:",
      "  custom:",
      "    title: Custom",
      "    numbered: true",
      "---",
      "Content",
    ].join("\n");
    const state = createEditorState(initialDoc);
    const registry1 = state.field(pluginRegistryField);
    expect(getPlugin(registry1, "custom")).toBeDefined();

    // Edit to remove the blocks section from frontmatter
    const newDoc = [
      "---",
      "title: No blocks",
      "---",
      "Content",
    ].join("\n");
    const tr = state.update({
      changes: { from: 0, to: state.doc.length, insert: newDoc },
    });
    const registry2 = tr.state.field(pluginRegistryField);
    // Custom block should be gone since frontmatter no longer defines it
    expect(getPlugin(registry2, "custom")).toBeUndefined();
    // Built-in plugins should still be present
    expect(getPlugin(registry2, "theorem")).toBeDefined();
    expect(getPlugin(registry2, "lemma")).toBeDefined();
    expect(getPlugin(registry2, "proof")).toBeDefined();
  });

  it("restores built-in plugins when frontmatter disabling is removed", () => {
    // Start with proof disabled
    const initialDoc = [
      "---",
      "blocks:",
      "  proof: false",
      "---",
      "Content",
    ].join("\n");
    const state = createEditorState(initialDoc);
    expect(getPlugin(state.field(pluginRegistryField), "proof")).toBeUndefined();

    // Remove the blocks section
    const newDoc = "---\ntitle: Fresh\n---\nContent";
    const tr = state.update({
      changes: { from: 0, to: state.doc.length, insert: newDoc },
    });
    // Proof should be restored from builtins
    expect(getPlugin(tr.state.field(pluginRegistryField), "proof")).toBeDefined();
  });

  it("does not change registry when doc change is outside frontmatter", () => {
    const doc = "---\ntitle: Test\n---\nContent here";
    const state = createEditorState(doc);
    const registry1 = state.field(pluginRegistryField);

    // Append text after frontmatter
    const tr = state.update({
      changes: { from: state.doc.length, insert: " more text" },
    });
    const registry2 = tr.state.field(pluginRegistryField);
    // Registry should still have same plugins
    expect(registry2.plugins.size).toBe(registry1.plugins.size);
  });
});
