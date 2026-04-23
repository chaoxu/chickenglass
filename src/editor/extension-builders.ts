import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  editableCompartment,
  lineNumbersCompartment,
  modeClassCompartment,
  renderCompartment,
  tabSizeCompartment,
  wordWrapCompartment,
} from "./compartments";

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
