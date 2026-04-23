import { syntaxHighlighting } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { cm6RichRenderExtensions } from "../render/cm6-rich-render-extensions";
import {
  editableCompartment,
  modeClassCompartment,
  renderCompartment,
  syntaxHighlightCompartment,
} from "./compartments";

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

const sourceSyntaxHighlightingExtension = syntaxHighlighting(classHighlighter);

export function setEditorMode(view: EditorView, mode: EditorMode): void {
  const effects: StateEffect<unknown>[] = [
    setEditorModeEffect.of(mode),
  ];

  switch (mode) {
    case "rich":
      effects.push(renderCompartment.reconfigure(cm6RichRenderExtensions));
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
