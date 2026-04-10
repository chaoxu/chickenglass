import { StateField } from "@codemirror/state";
import { buildDocumentLabelGraph, type DocumentLabelGraph } from "../semantics/document-label-graph";
import { blockCounterField } from "./block-counter";
import { createChangeChecker } from "./change-detection";
import { documentAnalysisField } from "./document-analysis";
import { pluginRegistryField } from "./plugin-registry";

const graphDependenciesChanged = createChangeChecker(
  { doc: true },
  (state) => state.field(documentAnalysisField),
  (state) => state.field(blockCounterField, false),
  (state) => state.field(pluginRegistryField, false),
);

export const documentLabelGraphField = StateField.define<DocumentLabelGraph>({
  create(state) {
    return buildDocumentLabelGraph(state);
  },

  update(value, tr) {
    if (!graphDependenciesChanged(tr)) {
      return value;
    }
    return buildDocumentLabelGraph(tr.state);
  },
});
