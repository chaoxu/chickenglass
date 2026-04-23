import { type Extension } from "@codemirror/state";
import type { BlockPlugin } from "./block-plugin";
import { bibDataField } from "./bib-data";
import { blockCounterField } from "./block-counter";
import { activeStructureEditField } from "./cm-structure-edit";
import { documentSemanticsField } from "./document-analysis";
import { documentLabelGraphField } from "./document-label-graph";
import { frontmatterField } from "./frontmatter-state";
import { imageUrlField } from "./image-url";
import { pdfPreviewField } from "./pdf-preview";
import { createPluginRegistryField } from "./plugin-registry";
import { referencePresentationField } from "../references/presentation";
import {
  editorBlockReferenceTargetInputsField,
  documentReferenceCatalogField,
} from "../semantics/editor-reference-catalog";

export function coreDocumentStateExtensions(
  defaultPlugins: readonly BlockPlugin[],
): Extension[] {
  return [
    frontmatterField,
    activeStructureEditField,
    documentSemanticsField,
    createPluginRegistryField(defaultPlugins),
    blockCounterField,
    editorBlockReferenceTargetInputsField,
    documentReferenceCatalogField,
    documentLabelGraphField,
    bibDataField,
    // Presentation text depends on bibliography and reference-catalog state.
    referencePresentationField,
    pdfPreviewField,
    imageUrlField,
  ];
}
