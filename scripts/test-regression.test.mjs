import { describe, expect, it } from "vitest";

import {
  BROWSER_TEST_GROUPS,
  expandBrowserTestSelection,
  formatBrowserTestList,
} from "./browser-test-groups.mjs";

describe("browser regression test groups", () => {
  it("expands named groups and explicit filters into a de-duplicated selection", () => {
    const selection = expandBrowserTestSelection({
      availableTestNames: [
        "block-insert-focus",
        "block-widget-keyboard-access",
        "cursor-reveal-edge-cases",
        "lexical-smoke",
      ],
      filterArg: "lexical-smoke",
      groupArg: "navigation",
    });

    expect(selection.unknownGroups).toEqual([]);
    expect(selection.unknownTests).toEqual([
      "focus-command-surfaces",
      "nested-blank-click-selection",
      "undo-bridge",
    ]);
    expect(selection.selected).toEqual([
      "block-insert-focus",
      "block-widget-keyboard-access",
      "lexical-smoke",
    ]);
  });

  it("lists groups for discovery", () => {
    const output = formatBrowserTestList([
      { name: "lexical-smoke" },
      { name: "cursor-reveal-edge-cases" },
    ]);

    expect(output).toContain("Available browser regression tests:");
    expect(output).toContain("lexical-smoke");
    expect(output).toContain("Groups:");
    expect(output).toContain(`core: ${BROWSER_TEST_GROUPS.core.join(", ")}`);
  });
});
