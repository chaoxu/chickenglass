import type { Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bibliographyPlugin } from "./bibliography-render";
import { checkboxRenderPlugin } from "./checkbox-render";
import { codeBlockRenderPlugin, codeBlockStructureField } from "./code-block-render";
import { cm6RichRenderExtensions } from "./cm6-rich-render-extensions";
import { containerAttributesPlugin } from "./container-attributes";
import { fenceGuidePlugin } from "./fence-guide";
import { frontmatterDecoration } from "./frontmatter-render";
import { imageRenderPlugin } from "./image-render";
import { sharedInlineRenderExtensions } from "./inline-render-extensions";
import { mathPreviewPlugin } from "./math-preview";
import { blockRenderPlugin } from "./plugin-render";
import { referenceRenderPlugin } from "./reference-render";
import { richClipboardOutputFilter } from "./rich-clipboard";
import { searchHighlightPlugin } from "./search-highlight";
import { sectionNumberPlugin } from "./section-counter";
import { sidenoteRenderPlugin } from "./sidenote-render";
import { tableRenderPlugin } from "./table-render";

function extensionIndex(extension: Extension): number {
  const index = cm6RichRenderExtensions.indexOf(extension);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function expectOrderedBefore(left: Extension, right: Extension): void {
  expect(extensionIndex(left)).toBeLessThan(extensionIndex(right));
}

describe("CM6 rich render extension composition", () => {
  it("keeps rich rendering ordered by owner dependencies", () => {
    expect(cm6RichRenderExtensions[0]).toBe(frontmatterDecoration);
    expect(cm6RichRenderExtensions.slice(1, 1 + sharedInlineRenderExtensions.length))
      .toEqual(sharedInlineRenderExtensions);

    expectOrderedBefore(imageRenderPlugin, blockRenderPlugin);
    expectOrderedBefore(codeBlockStructureField, blockRenderPlugin);
    expectOrderedBefore(blockRenderPlugin, referenceRenderPlugin);
    expectOrderedBefore(referenceRenderPlugin, tableRenderPlugin);
    expectOrderedBefore(tableRenderPlugin, searchHighlightPlugin);
    expect(cm6RichRenderExtensions.at(-1)).toBe(searchHighlightPlugin);
  });

  it("includes the expected render-owned feature extensions", () => {
    const expectedExtensions: readonly Extension[] = [
      codeBlockRenderPlugin,
      bibliographyPlugin,
      containerAttributesPlugin,
      richClipboardOutputFilter,
      checkboxRenderPlugin,
      mathPreviewPlugin,
      sectionNumberPlugin,
      fenceGuidePlugin,
      sidenoteRenderPlugin,
    ];

    for (const extension of expectedExtensions) {
      expect(cm6RichRenderExtensions.includes(extension)).toBe(true);
    }
  });
});
