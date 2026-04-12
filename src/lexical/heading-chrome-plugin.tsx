import { useEffect, useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { extractHeadingDefinitions } from "../app/markdown/headings";

// NOTE: This plugin must never mutate the Text node contents under a heading
// element. Lexical reconciles from its internal state into the DOM, and its
// MutationObserver reads DOM text back into state. Stripping the Pandoc
// attribute suffix from the rendered text causes the next keystroke to push
// the stripped text back into the Lexical TextNode, silently losing the
// authored `{-}` / `{.unnumbered}` / `{#id}` attribute block (issue #98).
// Only set data-* attributes here; visual treatment of the attribute suffix
// belongs to CSS.
export function syncHeadingChrome(root: HTMLElement | null, doc: string): void {
  if (!root) {
    return;
  }

  const headings = extractHeadingDefinitions(doc);
  const elements = [...root.querySelectorAll<HTMLElement>(".cf-lexical-heading")];

  for (const element of elements) {
    delete element.dataset.coflatHeadingNumber;
  }

  elements.forEach((element, index) => {
    const heading = headings[index];
    if (!heading) {
      return;
    }

    element.dataset.coflatHeadingPos = String(heading.pos);

    if (heading.number) {
      element.dataset.coflatHeadingNumber = heading.number;
    }
  });
}

export function HeadingChromePlugin({
  doc,
}: {
  readonly doc: string;
}) {
  const [editor] = useLexicalComposerContext();
  const syncToken = useMemo(() => ({ doc }), [doc]);

  useEffect(() => {
    const sync = () => {
      syncHeadingChrome(editor.getRootElement(), syncToken.doc);
    };

    sync();
    return editor.registerUpdateListener(() => {
      sync();
    });
  }, [editor, syncToken]);

  return null;
}
