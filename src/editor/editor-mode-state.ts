import { syntaxHighlighting } from "@codemirror/language";
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { bibliographyPlugin } from "../render/bibliography-render";
import {
  blockRenderPlugin,
  checkboxRenderPlugin,
  codeBlockRenderPlugin,
  codeBlockStructureField,
  containerAttributesPlugin,
  fenceGuidePlugin,
  imageRenderPlugin,
  mathPreviewPlugin,
  sectionNumberPlugin,
  sidenoteRenderPlugin,
} from "../render";
import { referenceRenderPlugin } from "../render/reference-render";
import { searchHighlightPlugin } from "../render/search-highlight";
import { tableRenderPlugin } from "../render/table-render";
import {
  editableCompartment,
  modeClassCompartment,
  renderCompartment,
  syntaxHighlightCompartment,
} from "./compartments";
import { sharedInlineRenderExtensions } from "./base-editor-extensions";
import { frontmatterDecoration } from "./frontmatter-render";
import { richClipboardOutputFilter } from "./rich-clipboard";

export type EditorMode = "rich" | "source";

export const markdownEditorModes: readonly EditorMode[] = ["rich", "source"];

export const setEditorModeEffect = StateEffect.define<EditorMode>();

export const editorModeField = StateField.define<EditorMode>({
  create() {
    return "rich";
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorModeEffect)) return effect.value;
    }
    return value;
  },
});

export const renderingExtensions: Extension[] = [
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

const sourceSyntaxHighlightingExtension = syntaxHighlighting(classHighlighter);

export function setEditorMode(view: EditorView, mode: EditorMode): void {
  const effects: StateEffect<unknown>[] = [
    setEditorModeEffect.of(mode),
  ];

  switch (mode) {
    case "rich":
      effects.push(renderCompartment.reconfigure(renderingExtensions));
      effects.push(editableCompartment.reconfigure([]));
      effects.push(modeClassCompartment.reconfigure([]));
      effects.push(syntaxHighlightCompartment.reconfigure([]));
      break;
    case "source":
      effects.push(renderCompartment.reconfigure([]));
      effects.push(editableCompartment.reconfigure([]));
      effects.push(modeClassCompartment.reconfigure(
        EditorView.editorAttributes.of({ class: "cf-source-mode" }),
      ));
      effects.push(syntaxHighlightCompartment.reconfigure(sourceSyntaxHighlightingExtension));
      break;
  }

  view.dispatch({ effects });
}
