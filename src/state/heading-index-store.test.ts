import { describe, expect, it } from "vitest";

import { useHeadingIndexStore } from "./heading-index-store";

describe("heading index store", () => {
  it("stores headings from non-CM6 editor surfaces", () => {
    useHeadingIndexStore.getState().reset();
    useHeadingIndexStore.getState().setHeadings([
      { level: 1, text: "Intro", number: "1", pos: 0 },
    ]);

    expect(useHeadingIndexStore.getState().headings[0]?.text).toBe("Intro");
  });
});
