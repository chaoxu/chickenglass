import { registerRenderers } from "../nodes/renderer-registry";
import { FootnoteReferenceRenderer } from "./footnote-renderers";
import { RawBlockRenderer } from "./raw-block-dispatch";

export function registerCoflatDecoratorRenderers(): void {
  registerRenderers({
    footnoteReference: FootnoteReferenceRenderer,
    rawBlock: RawBlockRenderer,
  });
}
