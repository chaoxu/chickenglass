import { describe, expect, it } from "vitest";

import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { fencedDiv } from "../parser/fenced-div";

import {
  createRegistryState,
  registerPlugins,
  type PluginRegistryState,
} from "./plugin-registry";
import { computeBlockNumbers } from "./block-counter";
import { defaultPlugins } from "./default-plugins";

import {
  embedPlugin,
  iframePlugin,
  youtubePlugin,
  gistPlugin,
  embedFamilyPlugins,
  isValidEmbedUrl,
  extractYoutubeId,
  youtubeEmbedUrl,
  gistEmbedUrl,
} from "./embed-plugin";

/** Create an EditorState with fenced div parser. */
function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [fencedDiv] })],
  });
}

/** Create a registry loaded with all default plugins. */
function defaultRegistry(): PluginRegistryState {
  return registerPlugins(createRegistryState(), defaultPlugins);
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe("isValidEmbedUrl", () => {
  it("accepts https URLs", () => {
    expect(isValidEmbedUrl("https://example.com")).toBe(true);
    expect(isValidEmbedUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
  });

  it("rejects http URLs", () => {
    expect(isValidEmbedUrl("http://example.com")).toBe(false);
  });

  it("rejects javascript: URLs", () => {
    expect(isValidEmbedUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(isValidEmbedUrl("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(isValidEmbedUrl("not a url")).toBe(false);
    expect(isValidEmbedUrl("")).toBe(false);
  });

  it("trims whitespace", () => {
    expect(isValidEmbedUrl("  https://example.com  ")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// YouTube ID extraction
// ---------------------------------------------------------------------------

describe("extractYoutubeId", () => {
  it("extracts from watch URL", () => {
    expect(extractYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("extracts from youtu.be short URL", () => {
    expect(extractYoutubeId("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("extracts from embed URL", () => {
    expect(
      extractYoutubeId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  it("extracts from watch URL without www", () => {
    expect(extractYoutubeId("https://youtube.com/watch?v=abc123")).toBe(
      "abc123",
    );
  });

  it("returns undefined for non-YouTube URLs", () => {
    expect(extractYoutubeId("https://example.com/video")).toBeUndefined();
  });

  it("returns undefined for invalid URLs", () => {
    expect(extractYoutubeId("not a url")).toBeUndefined();
  });

  it("returns undefined for watch URL without v param", () => {
    expect(
      extractYoutubeId("https://www.youtube.com/watch?list=abc"),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// YouTube embed URL
// ---------------------------------------------------------------------------

describe("youtubeEmbedUrl", () => {
  it("builds embed URL from video ID", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });
});

// ---------------------------------------------------------------------------
// Gist embed URL
// ---------------------------------------------------------------------------

describe("gistEmbedUrl", () => {
  it("appends .pibb to gist URL", () => {
    expect(gistEmbedUrl("https://gist.github.com/user/abc123")).toBe(
      "https://gist.github.com/user/abc123.pibb",
    );
  });

  it("does not double-append .pibb", () => {
    expect(gistEmbedUrl("https://gist.github.com/user/abc123.pibb")).toBe(
      "https://gist.github.com/user/abc123.pibb",
    );
  });

  it("handles trailing slash", () => {
    expect(gistEmbedUrl("https://gist.github.com/user/abc123/")).toBe(
      "https://gist.github.com/user/abc123.pibb",
    );
  });
});

// ---------------------------------------------------------------------------
// Plugin shape
// ---------------------------------------------------------------------------

describe("embedPlugin", () => {
  it("is unnumbered", () => {
    expect(embedPlugin.numbered).toBe(false);
  });

  it("has correct name", () => {
    expect(embedPlugin.name).toBe("embed");
  });

  it("renders header without number", () => {
    const spec = embedPlugin.render({ type: "embed" });
    expect(spec.header).toBe("Embed");
    expect(spec.className).toBe("cg-block cg-block-embed");
  });

  it("renders header with title", () => {
    const spec = embedPlugin.render({
      type: "embed",
      title: "My Widget",
    });
    expect(spec.header).toBe("Embed (My Widget)");
  });
});

describe("iframePlugin", () => {
  it("is unnumbered", () => {
    expect(iframePlugin.numbered).toBe(false);
  });

  it("has correct name", () => {
    expect(iframePlugin.name).toBe("iframe");
  });

  it("renders correctly", () => {
    const spec = iframePlugin.render({ type: "iframe" });
    expect(spec.header).toBe("Iframe");
    expect(spec.className).toBe("cg-block cg-block-iframe");
  });
});

describe("youtubePlugin", () => {
  it("is unnumbered", () => {
    expect(youtubePlugin.numbered).toBe(false);
  });

  it("has correct name", () => {
    expect(youtubePlugin.name).toBe("youtube");
  });

  it("renders correctly", () => {
    const spec = youtubePlugin.render({ type: "youtube" });
    expect(spec.header).toBe("YouTube");
    expect(spec.className).toBe("cg-block cg-block-youtube");
  });
});

describe("gistPlugin", () => {
  it("is unnumbered", () => {
    expect(gistPlugin.numbered).toBe(false);
  });

  it("has correct name", () => {
    expect(gistPlugin.name).toBe("gist");
  });

  it("renders correctly", () => {
    const spec = gistPlugin.render({ type: "gist" });
    expect(spec.header).toBe("Gist");
    expect(spec.className).toBe("cg-block cg-block-gist");
  });
});

describe("embedFamilyPlugins", () => {
  it("exports four plugins", () => {
    expect(embedFamilyPlugins).toHaveLength(4);
  });

  it("all are unnumbered", () => {
    for (const plugin of embedFamilyPlugins) {
      expect(plugin.numbered).toBe(false);
    }
  });

  it("has no counter groups", () => {
    for (const plugin of embedFamilyPlugins) {
      expect(plugin.counter).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: embed blocks are not numbered
// ---------------------------------------------------------------------------

describe("embed blocks are not numbered", () => {
  it("embed blocks do not appear in block counter output", () => {
    const doc = [
      "::: {.embed}",
      "https://example.com",
      ":::",
      "",
      "::: {.youtube}",
      "https://www.youtube.com/watch?v=abc",
      ":::",
      "",
      "::: {.theorem}",
      "A theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = defaultRegistry();
    const result = computeBlockNumbers(state, registry);

    // Only the theorem should be numbered
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// defaultPlugins includes embed plugins
// ---------------------------------------------------------------------------

describe("defaultPlugins includes embed plugins", () => {
  it("contains all 16 default plugins", () => {
    expect(defaultPlugins).toHaveLength(16);
  });

  it("includes embed plugin names", () => {
    const names = defaultPlugins.map((p) => p.name);
    expect(names).toContain("embed");
    expect(names).toContain("iframe");
    expect(names).toContain("youtube");
    expect(names).toContain("gist");
  });
});

// ---------------------------------------------------------------------------
// Edge case 4: gist embed blocks — full URL handling
// ---------------------------------------------------------------------------

describe("gist embed block edge cases", () => {
  it("gist URL is valid for embedding", () => {
    expect(
      isValidEmbedUrl("https://gist.github.com/user/abc123"),
    ).toBe(true);
  });

  it("gist URL produces correct .pibb embed URL", () => {
    expect(
      gistEmbedUrl("https://gist.github.com/user/abc123"),
    ).toBe("https://gist.github.com/user/abc123.pibb");
  });

  it("gist URL with revision hash works", () => {
    expect(
      gistEmbedUrl("https://gist.github.com/user/abc123/def456"),
    ).toBe("https://gist.github.com/user/abc123/def456.pibb");
  });

  it("gist URL with whitespace is trimmed", () => {
    expect(
      gistEmbedUrl("  https://gist.github.com/user/abc123  "),
    ).toBe("https://gist.github.com/user/abc123.pibb");
  });

  it("gist plugin renders header correctly", () => {
    const spec = gistPlugin.render({ type: "gist" });
    expect(spec.header).toBe("Gist");
    expect(spec.className).toBe("cg-block cg-block-gist");
  });

  it("gist plugin renders header with title", () => {
    const spec = gistPlugin.render({ type: "gist", title: "My Snippet" });
    expect(spec.header).toBe("Gist (My Snippet)");
  });

  it("gist block parsed as FencedDiv in editor state", () => {
    const doc = "::: {.gist}\nhttps://gist.github.com/user/abc123\n:::";
    const state = createState(doc);
    const tree = syntaxTree(state);
    let hasFencedDiv = false;
    tree.iterate({
      enter(node: { name: string }) {
        if (node.name === "FencedDiv") hasFencedDiv = true;
      },
    });
    expect(hasFencedDiv).toBe(true);
  });

  it("gist block is registered and not numbered", () => {
    const registry = defaultRegistry();
    const doc = "::: {.gist}\nhttps://gist.github.com/user/abc123\n:::";
    const state = createState(doc);
    const result = computeBlockNumbers(state, registry);
    // Gist blocks should not appear in numbered blocks
    expect(result.blocks).toHaveLength(0);
  });
});
