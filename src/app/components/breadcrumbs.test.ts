import { describe, it, expect } from "vitest";
import { ancestryEqual, applyBreadcrumbVisibility } from "./breadcrumbs";
import type { HeadingEntry } from "../heading-ancestry";
import { CSS } from "../../constants/css-classes";

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

describe("applyBreadcrumbVisibility", () => {
  it("toggles breadcrumb visibility classes without inline styles", () => {
    const el = document.createElement("div");
    el.className = CSS.breadcrumbs;

    applyBreadcrumbVisibility(el, false, true);
    expect(el.classList.contains(CSS.breadcrumbsHidden)).toBe(true);
    expect(el.classList.contains(CSS.breadcrumbsVisible)).toBe(false);
    expect(el.classList.contains(CSS.breadcrumbsInstant)).toBe(true);
    expect(el.getAttribute("style")).toBeNull();

    applyBreadcrumbVisibility(el, true, false);
    expect(el.classList.contains(CSS.breadcrumbsHidden)).toBe(false);
    expect(el.classList.contains(CSS.breadcrumbsVisible)).toBe(true);
    expect(el.classList.contains(CSS.breadcrumbsInstant)).toBe(false);
    expect(el.getAttribute("style")).toBeNull();
  });
});
