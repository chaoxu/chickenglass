import { describe, expect, it } from "vitest";
import { marginThemeStyles } from "./margin-theme";

describe("marginThemeStyles reference autocomplete", () => {
  it("uses the project popup surface and neutral selected-row colors", () => {
    expect(
      marginThemeStyles[".cm-tooltip.cm-tooltip-autocomplete.cf-reference-completion-tooltip"],
    ).toMatchObject({
      backgroundColor: "var(--cf-bg)",
      border: "1px solid var(--cf-border)",
      color: "var(--cf-fg)",
      fontFamily: "var(--cf-ui-font)",
    });

    expect(
      marginThemeStyles[".cm-tooltip.cm-tooltip-autocomplete.cf-reference-completion-tooltip > ul"],
    ).toMatchObject({
      maxHeight: "32em",
      whiteSpace: "normal",
    });

    expect(
      marginThemeStyles[".cm-tooltip.cm-tooltip-autocomplete.cf-reference-completion-tooltip > ul > li[aria-selected]"],
    ).toMatchObject({
      backgroundColor: "var(--cf-hover)",
      color: "var(--cf-fg)",
    });
  });

  it("keeps completion previews readable when rows wrap and render inline math", () => {
    expect(
      marginThemeStyles[".cf-reference-completion-crossref .cf-reference-completion-content"],
    ).toMatchObject({
      display: "flex",
      flexDirection: "column",
    });

    expect(
      marginThemeStyles[".cf-reference-completion-crossref .cf-reference-completion-meta"],
    ).toMatchObject({
      color: "var(--cf-muted)",
      fontFamily: "var(--cf-ui-font)",
    });

    expect(marginThemeStyles[".cf-reference-completion-preview .katex"]).toMatchObject({
      fontSize: "1em",
    });
  });
});
