import { describe, it, expect } from "vitest";
import {
  ancestryEqual,
  INITIAL_BREADCRUMB_VISIBILITY_STATE,
  reduceBreadcrumbVisibility,
} from "./breadcrumbs";
import type { HeadingEntry } from "../heading-ancestry";

describe("ancestryEqual", () => {
  const entry = (overrides: Partial<HeadingEntry> = {}): HeadingEntry => ({
    level: 2,
    text: "Open Problems",
    number: "1.1",
    pos: 10,
    ...overrides,
  });

  it("returns true for identical entries", () => {
    const a = [entry()];
    const b = [entry()];
    expect(ancestryEqual(a, b)).toBe(true);
  });

  it("returns false for different lengths", () => {
    expect(ancestryEqual([entry()], [])).toBe(false);
    expect(ancestryEqual([], [entry()])).toBe(false);
  });

  it("returns true for two empty arrays", () => {
    expect(ancestryEqual([], [])).toBe(true);
  });

  it("detects in-place heading text change (same pos)", () => {
    const a = [entry({ text: "Open Problems" })];
    const b = [entry({ text: "Solved Problems" })];
    expect(ancestryEqual(a, b)).toBe(false);
  });

  it("detects section number change (same pos)", () => {
    const a = [entry({ number: "1.1" })];
    const b = [entry({ number: "1.2" })];
    expect(ancestryEqual(a, b)).toBe(false);
  });

  it("detects level change (same pos)", () => {
    const a = [entry({ level: 2 })];
    const b = [entry({ level: 3 })];
    expect(ancestryEqual(a, b)).toBe(false);
  });

  it("detects pos change", () => {
    const a = [entry({ pos: 10 })];
    const b = [entry({ pos: 20 })];
    expect(ancestryEqual(a, b)).toBe(false);
  });

  it("compares all entries in a multi-heading chain", () => {
    const a = [entry({ level: 1, pos: 0 }), entry({ level: 2, pos: 10 })];
    const b = [entry({ level: 1, pos: 0 }), entry({ level: 2, pos: 10, text: "Renamed" })];
    expect(ancestryEqual(a, b)).toBe(false);
  });
});

describe("reduceBreadcrumbVisibility", () => {
  it("marks a pending reveal when scroll happens before ancestry exists", () => {
    expect(
      reduceBreadcrumbVisibility(INITIAL_BREADCRUMB_VISIBILITY_STATE, {
        type: "scroll-without-ancestry",
      }),
    ).toEqual({
      visibility: "hidden",
      instant: true,
      hovered: false,
      pendingReveal: true,
    });
  });

  it("reveals after ancestry becomes available for a pending scroll", () => {
    const pendingState = reduceBreadcrumbVisibility(
      INITIAL_BREADCRUMB_VISIBILITY_STATE,
      { type: "scroll-without-ancestry" },
    );

    expect(
      reduceBreadcrumbVisibility(pendingState, { type: "ancestry-available" }),
    ).toEqual({
      visibility: "visible",
      instant: false,
      hovered: false,
      pendingReveal: false,
    });
  });

  it("keeps the breadcrumb visible while hovered", () => {
    const hoveredState = reduceBreadcrumbVisibility(
      INITIAL_BREADCRUMB_VISIBILITY_STATE,
      { type: "hover-start" },
    );

    expect(
      reduceBreadcrumbVisibility(hoveredState, { type: "hide" }),
    ).toBe(hoveredState);
  });

  it("hides instantly and clears hover state when ancestry disappears", () => {
    const visibleState = {
      visibility: "visible" as const,
      instant: false,
      hovered: true,
      pendingReveal: false,
    };

    expect(
      reduceBreadcrumbVisibility(visibleState, { type: "ancestry-cleared" }),
    ).toEqual(INITIAL_BREADCRUMB_VISIBILITY_STATE);
  });
});
