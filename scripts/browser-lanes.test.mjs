import { describe, expect, it } from "vitest";

import {
  BROWSER_LANE_ORDER,
  BROWSER_LANES,
  browserAreaTouched,
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
      "src/lexical/markdown.ts",
      "src/render/pdf-preview-cache.ts",
      "src/editor/scroll-guard.ts",
    ])).toEqual(["cm6-rich", "lexical", "media", "scroll"]);
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
});
