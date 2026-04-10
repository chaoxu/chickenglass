import { describe, expect, it } from "vitest";
import { createChangeChecker } from "./change-detection";

interface TestState {
  readonly count: number;
  readonly label: string;
  readonly items: readonly string[];
}

describe("createChangeChecker", () => {
  it("detects changes via simple function selectors", () => {
    const checker = createChangeChecker<TestState>(
      (state) => state.count,
    );

    expect(checker(
      { count: 1, label: "a", items: [] },
      { count: 2, label: "a", items: [] },
    )).toBe(true);

    expect(checker(
      { count: 1, label: "a", items: [] },
      { count: 1, label: "b", items: [] },
    )).toBe(false);
  });

  it("detects changes across multiple selectors", () => {
    const checker = createChangeChecker<TestState>(
      (state) => state.count,
      (state) => state.label,
    );

    expect(checker(
      { count: 1, label: "a", items: [] },
      { count: 1, label: "b", items: [] },
    )).toBe(true);
  });

  it("returns false when no selectors detect changes", () => {
    const checker = createChangeChecker<TestState>(
      (state) => state.count,
      (state) => state.label,
    );

    const state: TestState = { count: 1, label: "a", items: [] };
    expect(checker(state, state)).toBe(false);
  });

  it("uses custom equality when provided", () => {
    const checker = createChangeChecker<TestState>({
      get: (state) => state.items,
      equals: (a, b) => a.length === b.length,
    });

    expect(checker(
      { count: 1, label: "a", items: ["x"] },
      { count: 1, label: "a", items: ["y"] },
    )).toBe(false);

    expect(checker(
      { count: 1, label: "a", items: ["x"] },
      { count: 1, label: "a", items: ["x", "y"] },
    )).toBe(true);
  });

  it("defaults to Object.is for equality", () => {
    const sharedItems = ["x"];
    const checker = createChangeChecker<TestState>(
      (state) => state.items,
    );

    expect(checker(
      { count: 1, label: "a", items: sharedItems },
      { count: 1, label: "a", items: sharedItems },
    )).toBe(false);

    expect(checker(
      { count: 1, label: "a", items: ["x"] },
      { count: 1, label: "a", items: ["x"] },
    )).toBe(true);
  });

  it("returns false with zero selectors", () => {
    const checker = createChangeChecker<TestState>();

    expect(checker(
      { count: 1, label: "a", items: [] },
      { count: 2, label: "b", items: ["x"] },
    )).toBe(false);
  });

  it("mixes function selectors and full selector objects", () => {
    const checker = createChangeChecker<TestState>(
      (state) => state.count,
      {
        get: (state) => state.items,
        equals: (a, b) => a.length === b.length,
      },
    );

    expect(checker(
      { count: 1, label: "a", items: ["x"] },
      { count: 1, label: "a", items: ["y"] },
    )).toBe(false);

    expect(checker(
      { count: 1, label: "a", items: ["x"] },
      { count: 2, label: "a", items: ["x"] },
    )).toBe(true);
  });
});
