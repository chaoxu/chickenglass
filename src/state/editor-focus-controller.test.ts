import { describe, expect, it } from "vitest";

import {
  clearFocusOwner,
  clearFocusOwnerIfMatch,
  FOCUS_NONE,
  focusSurface,
  setFocusOwner,
} from "./editor-focus";

describe("setFocusOwner", () => {
  it("activates a new owner", () => {
    const owner = focusSurface("rich-surface", "editor-a");

    expect(setFocusOwner(FOCUS_NONE, owner)).toEqual(owner);
  });

  it("returns the same reference when the owner is unchanged", () => {
    const owner = focusSurface("embedded-field", "editor-a");

    expect(setFocusOwner(owner, owner)).toBe(owner);
  });
});

describe("clearFocusOwner", () => {
  it("returns idle state for an active owner", () => {
    const owner = focusSurface("source-surface", "editor-a");

    expect(clearFocusOwner(owner)).toBe(FOCUS_NONE);
  });

  it("returns the same idle reference when already cleared", () => {
    expect(clearFocusOwner(FOCUS_NONE)).toBe(FOCUS_NONE);
  });
});

describe("clearFocusOwnerIfMatch", () => {
  it("clears the tracked owner when it matches", () => {
    const owner = focusSurface("source-bridge", "editor-a");

    expect(clearFocusOwnerIfMatch(owner, owner)).toBe(FOCUS_NONE);
  });

  it("preserves the tracked owner when another surface blurs", () => {
    const current = focusSurface("rich-surface", "editor-a");
    const other = focusSurface("embedded-field", "editor-b");

    expect(clearFocusOwnerIfMatch(current, other)).toBe(current);
  });
});
