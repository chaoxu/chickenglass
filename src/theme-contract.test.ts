import { describe, expect, it } from "vitest";
import {
  themeLayerTokenDefaults,
  themeLayerTokens,
  themeSurfaceTokenMap,
  themeTokenNames,
} from "./theme-contract";

describe("theme contract", () => {
  it("keeps shared layer tokens explicit and defaulted", () => {
    expect(themeLayerTokens).toEqual([
      "--cf-layer-inline-chrome",
      "--cf-layer-preview-surface",
      "--cf-layer-block-picker",
    ]);
    expect(themeLayerTokenDefaults).toEqual({
      "--cf-layer-inline-chrome": "1",
      "--cf-layer-preview-surface": "1000",
      "--cf-layer-block-picker": "1010",
    });
  });

  it("maps every surface token to a canonical token name", () => {
    const allTokens = new Set(themeTokenNames);

    for (const [surface, tokens] of Object.entries(themeSurfaceTokenMap)) {
      expect(tokens.length, `${surface} should expose tokens`).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(allTokens.has(token), `${surface} uses ${token}`).toBe(true);
      }
    }
  });

  it("keeps tooltip and block surfaces on the shared foreground and layer contracts", () => {
    expect(themeSurfaceTokenMap.tooltipAndHover).toEqual(expect.arrayContaining([
      "--cf-fg",
      "--cf-muted",
      "--cf-layer-preview-surface",
    ]));
    expect(themeSurfaceTokenMap.blockSurfaces).toEqual(expect.arrayContaining([
      "--cf-block-header-accent",
      "--cf-proof-marker",
      "--cf-layer-inline-chrome",
    ]));
  });
});
