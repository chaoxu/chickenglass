import { useEffect, useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { extractHeadingDefinitions } from "../app/markdown/headings";

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

    if (!heading.attrs) {
      return;
    }

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let lastText: Text | null = null;
    let current = walker.nextNode();
    while (current) {
      if (current instanceof Text) {
        lastText = current;
      }
      current = walker.nextNode();
    }

    if (!lastText || !lastText.textContent?.endsWith(heading.attrs)) {
      return;
    }

    lastText.textContent = lastText.textContent
      .slice(0, lastText.textContent.length - heading.attrs.length)
      .trimEnd();
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
