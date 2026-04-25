import { describe, expect, it } from "vitest";

import {
  BROWSER_HARNESS_SUPPORT_PATHS,
  BROWSER_LANE_ORDER,
  BROWSER_LANES,
  DOCUMENT_SURFACE_PARITY_PATH_PREFIXES,
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
      "lexical",
      "media",
      "navigation",
      "scroll",
      "render",
      "parity",
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
    expect(resolveBrowserLane("parity").name).toBe("parity");
    expect(BROWSER_LANES.parity.script).toBe("scripts/document-surface-parity.mjs");
  });

  it("selects all affected browser lanes from changed paths", () => {
    expect(selectBrowserLanesForChangedFiles([
      "src/lexical/markdown.ts",
      "src/render/pdf-preview-cache.ts",
      "src/editor/scroll-guard.ts",
    ])).toEqual(["cm6-rich", "lexical", "media", "scroll"]);
  });

  it("selects the parity lane for shared surface changes", () => {
    expect(selectBrowserLanesForChangedFiles([
      "src/lexical/editor-theme.css",
    ])).toEqual(["cm6-rich", "lexical", "parity"]);
    expect(selectBrowserLanesForChangedFiles([
      "src/lexical/renderers/fenced-div-renderers.tsx",
    ])).toEqual(["lexical", "parity"]);
    expect(selectBrowserLanesForChangedFiles([
      "src/render/preview-block-renderer.ts",
    ])).toEqual(["cm6-rich", "parity"]);
    expect(DOCUMENT_SURFACE_PARITY_PATH_PREFIXES).toEqual(expect.arrayContaining([
      "src/lexical/renderers/",
      "scripts/regression-tests/visual-surface-parity.mjs",
    ]));
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
