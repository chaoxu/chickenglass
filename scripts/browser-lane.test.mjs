import { describe, expect, it } from "vitest";

import {
  buildBrowserLaneArgs,
  formatBrowserLaneHelp,
  runBrowserLaneCli,
} from "./browser-lane.mjs";

describe("browser lane helper", () => {
  it("defaults to the smoke scenario", () => {
    expect(buildBrowserLaneArgs([])).toEqual([
      "scripts/test-regression.mjs",
      "--scenario",
      "smoke",
    ]);
    expect(buildBrowserLaneArgs(["--headed"])).toEqual([
      "scripts/test-regression.mjs",
      "--scenario",
      "smoke",
      "--headed",
    ]);
  });

  it("maps named quick lanes to regression filters", () => {
    expect(buildBrowserLaneArgs(["cm6-rich"])).toEqual([
      "scripts/test-regression.mjs",
      "--filter",
      expect.stringContaining("rendered-hit-testing"),
    ]);
    expect(buildBrowserLaneArgs(["media"])).toEqual([
      "scripts/test-regression.mjs",
      "--filter",
      expect.stringContaining("local-pdf-preview"),
    ]);
    expect(buildBrowserLaneArgs(["scroll"])).toEqual([
      "scripts/test-regression.mjs",
      "--filter",
      expect.stringContaining("scroll-jump-rankdecrease"),
    ]);
  });

  it("keeps compatibility render lane and full-suite lane", () => {
    expect(buildBrowserLaneArgs(["render"])).toEqual([
      "scripts/test-regression.mjs",
      "--filter",
      "headings,math-render,index-open-rich-render",
    ]);
    expect(buildBrowserLaneArgs(["all"])).toEqual([
      "scripts/test-regression.mjs",
    ]);
  });

  it("builds one-off filters from positional test names", () => {
    expect(buildBrowserLaneArgs(["one", "headings", "math-render"])).toEqual([
      "scripts/test-regression.mjs",
      "--filter",
      "headings,math-render",
    ]);
    expect(buildBrowserLaneArgs(["one", "headings", "--", "--headed"])).toEqual([
      "scripts/test-regression.mjs",
      "--filter",
      "headings",
      "--headed",
    ]);
  });

  it("requires at least one test for the one-off lane", () => {
    expect(() => buildBrowserLaneArgs(["one"])).toThrow(
      "browser lane `one` requires at least one regression test name.",
    );
  });

  it("prints lane help", () => {
    expect(formatBrowserLaneHelp()).toContain("render");
    expect(formatBrowserLaneHelp()).toContain("cm6-rich");
    expect(formatBrowserLaneHelp()).toContain("Lexical WYSIWYG and mode-switch lane");
  });

  it("runs the browser regression script", () => {
    const calls = [];
    const status = runBrowserLaneCli(["one", "headings"], {
      spawnSync(command, args) {
        calls.push([command, ...args]);
        return { status: 0 };
      },
    });

    expect(status).toBe(0);
    expect(calls).toEqual([
      ["node", "scripts/test-regression.mjs", "--filter", "headings"],
    ]);
  });
});
