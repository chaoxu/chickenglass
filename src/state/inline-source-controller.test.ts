import { describe, expect, it } from "vitest";
import {
  activateInlineSource,
  deactivateInlineSource,
  deactivateInlineSourceIfMatch,
  isActiveInlineSource,
} from "./inline-source-controller";
import { INLINE_SOURCE_INACTIVE, inlineSourceActive } from "./inline-source";

describe("activateInlineSource", () => {
  it("transitions from inactive to active", () => {
    const result = activateInlineSource(INLINE_SOURCE_INACTIVE, "key-1", "start");
    expect(result).toEqual({ status: "active", nodeKey: "key-1", entrySide: "start" });
  });

  it("returns same reference when same node and entry side", () => {
    const current = inlineSourceActive("key-1", "start");
    const result = activateInlineSource(current, "key-1", "start");
    expect(result).toBe(current);
  });

  it("transitions when entry side changes", () => {
    const current = inlineSourceActive("key-1", "start");
    const result = activateInlineSource(current, "key-1", "end");
    expect(result).toEqual({ status: "active", nodeKey: "key-1", entrySide: "end" });
    expect(result).not.toBe(current);
  });

  it("transitions to a different node", () => {
    const current = inlineSourceActive("key-1", "start");
    const result = activateInlineSource(current, "key-2", "end");
    expect(result).toEqual({ status: "active", nodeKey: "key-2", entrySide: "end" });
  });
});

describe("deactivateInlineSource", () => {
  it("transitions from active to inactive", () => {
    const current = inlineSourceActive("key-1", "start");
    const result = deactivateInlineSource(current);
    expect(result).toBe(INLINE_SOURCE_INACTIVE);
  });

  it("returns same reference when already inactive", () => {
    const result = deactivateInlineSource(INLINE_SOURCE_INACTIVE);
    expect(result).toBe(INLINE_SOURCE_INACTIVE);
  });
});

describe("deactivateInlineSourceIfMatch", () => {
  it("deactivates when node key matches", () => {
    const current = inlineSourceActive("key-1", "start");
    const result = deactivateInlineSourceIfMatch(current, "key-1");
    expect(result).toBe(INLINE_SOURCE_INACTIVE);
  });

  it("does not deactivate when node key differs", () => {
    const current = inlineSourceActive("key-1", "start");
    const result = deactivateInlineSourceIfMatch(current, "key-2");
    expect(result).toBe(current);
  });

  it("returns same reference when inactive", () => {
    const result = deactivateInlineSourceIfMatch(INLINE_SOURCE_INACTIVE, "key-1");
    expect(result).toBe(INLINE_SOURCE_INACTIVE);
  });
});

describe("isActiveInlineSource", () => {
  it("returns true for matching active node", () => {
    const state = inlineSourceActive("key-1", "start");
    expect(isActiveInlineSource(state, "key-1")).toBe(true);
  });

  it("returns false for different node key", () => {
    const state = inlineSourceActive("key-1", "start");
    expect(isActiveInlineSource(state, "key-2")).toBe(false);
  });

  it("returns false when inactive", () => {
    expect(isActiveInlineSource(INLINE_SOURCE_INACTIVE, "key-1")).toBe(false);
  });
});
