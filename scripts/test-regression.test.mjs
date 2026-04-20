import { describe, expect, it } from "vitest";

import {
  buildBrowserTestGroups,
  expandBrowserTestSelection,
  formatBrowserTestList,
  normalizeBrowserTestGroups,
} from "./browser-test-groups.mjs";

describe("browser regression test groups", () => {
  it("expands named groups and explicit filters into a de-duplicated selection", () => {
    const selection = expandBrowserTestSelection({
      tests: [
        { name: "block-insert-focus", groups: ["core", "navigation"] },
        { name: "block-widget-keyboard-access", groups: ["core", "navigation"] },
        { name: "cursor-reveal-edge-cases", groups: ["core", "reveal"] },
        { name: "lexical-smoke", groups: ["core", "smoke"] },
      ],
      filterArg: "lexical-smoke",
      groupArg: "navigation",
    });

    expect(selection.unknownGroups).toEqual([]);
    expect(selection.unknownTests).toEqual([]);
    expect(selection.selected).toEqual([
      "block-insert-focus",
      "block-widget-keyboard-access",
      "lexical-smoke",
    ]);
  });

  it("lists groups for discovery", () => {
    const tests = [
      { name: "lexical-smoke", groups: ["core", "smoke"] },
      { name: "cursor-reveal-edge-cases", groups: ["core", "reveal"] },
    ];
    const output = formatBrowserTestList(tests);
    const groups = buildBrowserTestGroups(tests);

    expect(output).toContain("Available browser regression tests:");
    expect(output).toContain("lexical-smoke [core, smoke]");
    expect(output).toContain("Groups:");
    expect(output).toContain(`core: ${groups.core.join(", ")}`);
  });

  it("rejects tests with no local group metadata", () => {
    expect(() => normalizeBrowserTestGroups("missing-groups.mjs")).toThrow(
      /missing groups export/,
    );
    expect(() => normalizeBrowserTestGroups("empty-groups.mjs", [])).toThrow(
      /at least one group/,
    );
  });
});
