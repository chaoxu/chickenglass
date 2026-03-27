import { describe, expect, it } from "vitest";
import { coalesceChangedRanges } from "./dirty-windows";

describe("coalesceChangedRanges", () => {
  it("coalesces adjacent edits into one window", () => {
    const windows = coalesceChangedRanges([
      { fromOld: 5, toOld: 5, fromNew: 5, toNew: 6 },
      { fromOld: 5, toOld: 5, fromNew: 6, toNew: 7 },
    ], 0);

    expect(windows).toEqual([
      { fromOld: 5, toOld: 5, fromNew: 5, toNew: 7 },
    ]);
  });

  it("keeps distant edits separate", () => {
    const windows = coalesceChangedRanges([
      { fromOld: 50, toOld: 51, fromNew: 50, toNew: 51 },
      { fromOld: 0, toOld: 1, fromNew: 0, toNew: 1 },
    ], 4);

    expect(windows).toEqual([
      { fromOld: 0, toOld: 1, fromNew: 0, toNew: 1 },
      { fromOld: 50, toOld: 51, fromNew: 50, toNew: 51 },
    ]);
  });

  it("preserves aligned old and new coordinate pairs when merging", () => {
    const windows = coalesceChangedRanges([
      { fromOld: 10, toOld: 12, fromNew: 10, toNew: 13 },
      { fromOld: 15, toOld: 15, fromNew: 16, toNew: 18 },
    ], 3);

    expect(windows).toEqual([
      { fromOld: 10, toOld: 15, fromNew: 10, toNew: 18 },
    ]);
  });

  it("keeps zero-width inserts as usable windows", () => {
    const windows = coalesceChangedRanges([
      { fromOld: 3, toOld: 3, fromNew: 3, toNew: 5 },
    ]);

    expect(windows).toEqual([
      { fromOld: 3, toOld: 3, fromNew: 3, toNew: 5 },
    ]);
  });
});
