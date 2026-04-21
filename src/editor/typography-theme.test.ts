import { describe, expect, it } from "vitest";
import { typographyThemeStyles } from "./typography-theme";

describe("typographyThemeStyles", () => {
  it("keeps inline source reveal typography from contributing line-box height", () => {
    for (const selector of [
      ".cf-source-delimiter",
      ".cf-inline-source",
      ".cf-math-source",
      ".cf-reference-source",
      ".cf-inline-code",
    ] as const) {
      expect(typographyThemeStyles[selector]).toMatchObject({
        fontSize: "0.85em",
        lineHeight: "0",
        verticalAlign: "baseline",
      });
    }
  });
});
