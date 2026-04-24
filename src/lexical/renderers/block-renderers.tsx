import type { JSX } from "react";

import { registerRenderers } from "../nodes/renderer-registry";
import { FootnoteReferenceRenderer } from "./footnote-renderers";
import { InlineImageRenderer } from "./inline-image-renderer";
import { InlineMathRenderer } from "./inline-math-renderer";
import { RawBlockRenderer } from "./raw-block-dispatch";
import { ReferenceRenderer } from "./reference-renderer";

function HeadingAttributeRenderer(): JSX.Element {
  return (
    <span
      aria-hidden
      className="cf-heading-attribute-token__content"
    />
  );
}

export function registerCoflatDecoratorRenderers(): void {
  registerRenderers({
    footnoteReference: FootnoteReferenceRenderer,
    headingAttribute: HeadingAttributeRenderer,
    inlineImage: InlineImageRenderer,
    inlineMath: InlineMathRenderer,
    rawBlock: RawBlockRenderer,
    reference: ReferenceRenderer,
  });
}
