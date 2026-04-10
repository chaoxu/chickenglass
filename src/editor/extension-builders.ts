import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { bibDataField } from "../citations";
import { includeRegionsField } from "../lib/include-regions";
import { createPluginRegistryField, defaultPlugins } from "../plugins";
import { imageUrlField } from "../render/image-url-cache";
import { pdfPreviewField } from "../render/pdf-preview-cache";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { documentLabelGraphField } from "../semantics/document-label-graph";
import { documentReferenceCatalogField } from "../semantics/editor-reference-catalog";
import { blockCounterField } from "../state/block-counter";
import {
  editableCompartment,
  lineNumbersCompartment,
  modeClassCompartment,
  renderCompartment,
  tabSizeCompartment,
  wordWrapCompartment,
} from "./compartments";
import { frontmatterField } from "./frontmatter-state";
import { activeStructureEditField } from "./structure-edit-state";

export function coreDocumentStateExtensions(): Extension[] {
  return [
    frontmatterField,
    activeStructureEditField,
    includeRegionsField,
    documentSemanticsField,
    createPluginRegistryField(defaultPlugins),
    blockCounterField,
    documentReferenceCatalogField,
    documentLabelGraphField,
    bibDataField,
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
