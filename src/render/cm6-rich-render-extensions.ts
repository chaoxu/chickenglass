import type { Extension } from "@codemirror/state";
import { bibliographyPlugin } from "./bibliography-render";
import { checkboxRenderPlugin } from "./checkbox-render";
import { codeBlockRenderPlugin, codeBlockStructureField } from "./code-block-render";
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

/**
 * CM6 rich-mode rendering, ordered by render dependency:
 * frontmatter shell, inline substitutions, block widgets, document
 * references/citations, structural adapters, clipboard balancing, tables,
 * light overlays, and search highlighting last so it can layer over widgets.
 */
export const cm6RichRenderExtensions: Extension[] = [
  frontmatterDecoration,
  ...sharedInlineRenderExtensions,
  imageRenderPlugin,
  codeBlockStructureField,
  blockRenderPlugin,
  referenceRenderPlugin,
  codeBlockRenderPlugin,
  bibliographyPlugin,
  containerAttributesPlugin,
  richClipboardOutputFilter,
  tableRenderPlugin,
  checkboxRenderPlugin,
  mathPreviewPlugin,
  sectionNumberPlugin,
  fenceGuidePlugin,
  sidenoteRenderPlugin,
  searchHighlightPlugin,
];
