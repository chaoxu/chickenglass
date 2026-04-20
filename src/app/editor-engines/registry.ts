import type { CoflatEditorEngine } from "../../product";
import type { EditorEngineReadiness } from "./types";

export const EDITOR_ENGINE_READINESS: Readonly<Record<CoflatEditorEngine, EditorEngineReadiness>> = {
  "cm6-markdown": {
    id: "cm6-markdown",
    integrated: true,
    sourceOwner: "coflat",
    notes: "Current Coflat CM6 markdown-native editor.",
  },
  "lexical-wysiwyg": {
    id: "lexical-wysiwyg",
    integrated: true,
    sourceOwner: "coflat2",
    notes: "Coflat 2 Lexical editor routed through the shared app shell by product selection.",
  },
};

export function getEditorEngineReadiness(engine: CoflatEditorEngine): EditorEngineReadiness {
  return EDITOR_ENGINE_READINESS[engine];
}
