import { registerCoflatDecoratorRenderers } from "../../lexical/renderers/block-renderers";

export function ensureLexicalEditorPaneBootstrapped(): void {
  registerCoflatDecoratorRenderers();
}
