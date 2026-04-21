import { describe, expect, it } from "vitest";

import { activeCoflatProduct } from "./product";

describe("Coflats product config", () => {
  it("exposes the unified app identity", () => {
    expect(activeCoflatProduct).toMatchObject({
      description: "Semantic document editor for mathematical writing.",
      displayName: "Coflats",
      id: "coflats",
    });
  });
});
