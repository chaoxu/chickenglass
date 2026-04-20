import { describe, expect, it } from "vitest";

import {
  BLOCK_MANIFEST_ENTRIES,
  getBlockPresentationKind,
  getManifestBlockTitle,
  isKnownManifestBlockType,
  isSearchIndexedBlock,
} from "./block-manifest";

describe("block manifest helpers", () => {
  it("recognizes every manifest entry through the canonical lookup", () => {
    for (const entry of BLOCK_MANIFEST_ENTRIES) {
      expect(isKnownManifestBlockType(entry.name)).toBe(true);
      expect(getManifestBlockTitle(entry)).not.toBe("");
    }
    expect(isKnownManifestBlockType("missing")).toBe(false);
  });

  it("derives fenced-div presentation kind from manifest metadata", () => {
    expect(getBlockPresentationKind("figure")).toBe("captioned");
    expect(getBlockPresentationKind("table")).toBe("captioned");
    expect(getBlockPresentationKind("youtube")).toBe("embed");
    expect(getBlockPresentationKind("blockquote")).toBe("blockquote");
    expect(getBlockPresentationKind("include")).toBe("include");
    expect(getBlockPresentationKind("theorem")).toBe("standard");
  });

  it("keeps transport-only and external embed blocks out of semantic search filters", () => {
    const indexedNames = BLOCK_MANIFEST_ENTRIES
      .filter(isSearchIndexedBlock)
      .map((entry) => entry.name);

    expect(indexedNames).toContain("theorem");
    expect(indexedNames).toContain("figure");
    expect(indexedNames).not.toContain("include");
    expect(indexedNames).not.toContain("youtube");
    expect(indexedNames).not.toContain("blockquote");
  });
});
