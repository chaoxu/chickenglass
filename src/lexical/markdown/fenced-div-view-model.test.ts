import { describe, expect, it } from "vitest";

import { parseStructuredFencedDivRaw } from "./block-syntax";
import { createFencedDivViewModel } from "./fenced-div-view-model";

function modelFor(raw: string, options?: Parameters<typeof createFencedDivViewModel>[1]) {
  return createFencedDivViewModel(parseStructuredFencedDivRaw(raw), options);
}

describe("fenced-div-view-model", () => {
  it("classifies fenced div presentation families", () => {
    expect(modelFor("::: {.custom-note}\nBody\n:::").kind).toBe("standard");
    expect(modelFor("::: {.blockquote}\nQuote\n:::").kind).toBe("blockquote");
    expect(modelFor("::: {.figure}\n![Alt](fig.png)\n:::").kind).toBe("captioned");
    expect(modelFor("::: {.theorem}\nBody\n:::").kind).toBe("standard");
  });

  it("resolves labels from references before frontmatter config", () => {
    expect(modelFor("::: {.theorem #thm:a}\nBody\n:::", {
      config: {
        blocks: {
          theorem: { title: "Configured theorem" },
        },
      },
      referenceLabel: "Theorem 1",
    }).label).toBe("Theorem 1");

    expect(modelFor("::: {.theorem}\nBody\n:::", {
      config: {
        blocks: {
          theorem: { title: "Configured theorem" },
        },
      },
    }).label).toBe("Configured theorem");
  });
});
