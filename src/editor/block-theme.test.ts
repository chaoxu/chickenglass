import { describe, expect, it } from "vitest";
import { blockThemeStyles } from "./block-theme";

describe("blockThemeStyles", () => {
  it("generates representative accent and body-style rules from the block manifest", () => {
    expect(
      blockThemeStyles[".cf-block-theorem .cf-block-header, .cf-block-theorem.cf-block-header"],
    ).toEqual({
      borderLeftColor: "var(--cf-block-theorem-accent)",
    });

    expect(blockThemeStyles[".cf-block-figure"]).toEqual({
      fontStyle: "var(--cf-block-figure-style)",
    });

    expect(
      blockThemeStyles[".cf-block-embed .cf-block-header, .cf-block-embed.cf-block-header"],
    ).toBeUndefined();
    expect(
      blockThemeStyles[
        ".cf-block-blockquote .cf-block-header, .cf-block-blockquote.cf-block-header"
      ],
    ).toBeUndefined();
  });

  it("keeps proof and caption styling on their token-driven structural selectors", () => {
    expect(blockThemeStyles[".cf-block-caption"]).toMatchObject({
      display: "block",
      marginTop: "var(--cf-spacing-xs)",
      textAlign: "center",
    });

    expect(blockThemeStyles[".cf-block-caption .cf-block-header-rendered::after"]).toEqual({
      content: "var(--cf-block-title-separator)",
    });

    expect(blockThemeStyles[".cf-block-proof .cf-block-header-rendered"]).toEqual({
      fontStyle: "italic",
      fontWeight: "400",
    });

    expect(blockThemeStyles[".cf-block-proof .cf-block-header-rendered::after"]).toEqual({
      content: '". "',
    });

    expect(blockThemeStyles[".cf-block-qed::after"]).toMatchObject({
      content: "var(--cf-proof-marker)",
      color: "var(--cf-proof-marker-color)",
      fontSize: "var(--cf-proof-marker-size)",
      float: "right",
    });
  });

  it("collapses include fences and preserves the table widget layout contract", () => {
    expect(blockThemeStyles[".cf-include-fence"]).toEqual({
      height: "0",
      lineHeight: "0",
      overflow: "hidden",
      padding: "0 !important",
      margin: "0",
    });

    expect(blockThemeStyles[".cf-table-widget"]).toEqual({
      margin: "var(--cf-spacing-sm) 0",
    });

    expect(blockThemeStyles[".cf-block-table .cf-table-widget"]).toEqual({
      width: "fit-content",
      maxWidth: "100%",
      margin: "var(--cf-spacing-sm) auto",
    });

    expect(blockThemeStyles[".cf-table-widget th, .cf-table-widget td"]).toMatchObject({
      border: "var(--cf-border-width) solid var(--cf-table-border)",
      padding: "var(--cf-table-cell-padding)",
      lineHeight: "var(--cf-table-line-height, 1.5)",
      textAlign: "left",
      verticalAlign: "top",
    });

    expect(blockThemeStyles[".cf-table-widget table"]).toEqual({
      borderCollapse: "collapse",
      width: "100%",
      fontSize: "var(--cf-table-font-size, 0.9em)",
    });

    expect(blockThemeStyles[".cf-table-widget th"]).toEqual({
      fontWeight: "700",
      borderBottom: "var(--cf-border-width-accent) solid var(--cf-table-header-border)",
    });
  });
});
