import { describe, expect, it, vi } from "vitest";

describe("LexicalEditorPane renderer registration", () => {
  it("registers decorator renderers in the production pane entrypoint", async () => {
    vi.resetModules();
    const registry = await import("../../lexical/nodes/renderer-registry");
    registry._resetRenderersForTest();

    expect(registry._hasRegisteredRenderersForTest()).toBe(false);

    await import("./lexical-editor-pane");

    expect(registry._hasRegisteredRenderersForTest()).toBe(true);
  });
});
