import { describe, expect, it } from "vitest";

import {
  BROWSER_HARNESS_SUPPORT_PATHS,
  BROWSER_LANE_ORDER,
  BROWSER_LANES,
  browserAreaTouched,
  isBrowserHarnessSupportPath,
  resolveBrowserLane,
  selectBrowserLanesForChangedFiles,
} from "./browser-lanes.mjs";

describe("browser lanes manifest", () => {
  it("exposes supported lanes in deterministic order", () => {
    expect(BROWSER_LANE_ORDER).toEqual([
      "smoke",
      "cm6-rich",
      "media",
      "navigation",
      "scroll",
      "render",
      "dogfood",
      "all",
    ]);
  });

  it("builds filter args from lane filter lists", () => {
    expect(BROWSER_LANES["cm6-rich"].args).toEqual([
      "--filter",
      BROWSER_LANES["cm6-rich"].filters.join(","),
    ]);
    expect(BROWSER_LANES.media.args).toEqual([
      "--filter",
      BROWSER_LANES.media.filters.join(","),
    ]);
    expect(BROWSER_LANES.all.args).toEqual([]);
  });

  it("keeps the older render lane available", () => {
    expect(resolveBrowserLane("render").name).toBe("render");
    expect(BROWSER_LANES.render.filters).toEqual(["headings", "math-render", "index-open-rich-render"]);
  });

  it("selects all affected browser lanes from changed paths", () => {
    expect(selectBrowserLanesForChangedFiles([
      "src/render/pdf-preview-cache.ts",
      "src/editor/scroll-guard.ts",
    ])).toEqual(["cm6-rich", "media", "scroll"]);
  });

  it("escalates browser harness changes to all only in full profile", () => {
    expect(browserAreaTouched(["scripts/browser-inspect.mjs"])).toBe(true);
    expect(selectBrowserLanesForChangedFiles(["scripts/browser-inspect.mjs"])).toEqual([
      "smoke",
    ]);
    expect(selectBrowserLanesForChangedFiles(["scripts/browser-inspect.mjs"], {
      profile: "full",
    })).toEqual(["all"]);
  });

  it("centralizes browser support helper ownership for changed-file lanes", () => {
    expect(BROWSER_HARNESS_SUPPORT_PATHS).toEqual(expect.arrayContaining([
      "scripts/browser-failure-artifacts.mjs",
      "scripts/browser-screenshot.mjs",
      "scripts/chrome-common.mjs",
      "scripts/editor-test-helpers.mjs",
      "scripts/fixture-test-helpers.mjs",
      "scripts/runtime-budget-profiles.mjs",
    ]));
    expect(isBrowserHarnessSupportPath("./scripts/fixture-test-helpers.mjs")).toBe(true);
    expect(browserAreaTouched(["scripts/editor-test-helpers.mjs"])).toBe(true);
    expect(selectBrowserLanesForChangedFiles(["scripts/runtime-budget-profiles.mjs"])).toEqual(["smoke"]);
    expect(selectBrowserLanesForChangedFiles(["scripts/browser-screenshot.mjs"], {
      profile: "full",
    })).toEqual(["all"]);
  });
});
