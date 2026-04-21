import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { bibDataField } from "../state/bib-data";
import { defaultPlugins } from "../plugins";
import { referencePresentationField } from "../references/presentation";
import {
  editorBlockReferenceTargetInputsField,
  documentReferenceCatalogField,
} from "../semantics/editor-reference-catalog";
import { blockCounterField } from "../state/block-counter";
import { documentSemanticsField } from "../state/document-analysis";
import { documentLabelGraphField } from "../state/document-label-graph";
import { imageUrlField } from "../state/image-url";
import { pdfPreviewField } from "../state/pdf-preview";
import { createPluginRegistryField } from "../state/plugin-registry";
import {
  editableCompartment,
  lineNumbersCompartment,
  modeClassCompartment,
  renderCompartment,
  tabSizeCompartment,
  wordWrapCompartment,
} from "./compartments";
import { frontmatterField } from "./frontmatter-state";
import { activeStructureEditField } from "../state/cm-structure-edit";

export function coreDocumentStateExtensions(): Extension[] {
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

interface RenderModeExtensionsOptions {
  readonly editorModeField: Extension;
  readonly renderingExtensions: Extension;
}

export function renderModeExtensions(
  options: RenderModeExtensionsOptions,
): Extension[] {
  return [
    renderCompartment.of(options.renderingExtensions),
    options.editorModeField,
    editableCompartment.of([]),
    modeClassCompartment.of([]),
  ];
}

export function userSettingsExtensions(
  defaultTabSizeExtension: Extension,
): Extension[] {
  return [
    wordWrapCompartment.of(EditorView.lineWrapping),
    lineNumbersCompartment.of([]),
    tabSizeCompartment.of(defaultTabSizeExtension),
  ];
}
