import { describe, expect, it } from "vitest";

import { collectImageTargets } from "./pdf-image-previews";

describe("collectImageTargets", () => {
  it("collects image URLs in document order", () => {
    const content = [
      "![first](images/first.png)",
      "",
      "Text.",
      "",
      "![second](figures/second.pdf)",
    ].join("\n");

    expect(collectImageTargets(content)).toEqual([
      "images/first.png",
      "figures/second.pdf",
    ]);
  });

  it("deduplicates repeated image URLs", () => {
    const content = "![a](fig.pdf)\n\n![b](fig.pdf)\n\n![c](other.png)";

    expect(collectImageTargets(content)).toEqual(["fig.pdf", "other.png"]);
  });
});
