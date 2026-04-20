import { extractHeadingDefinitions } from "../app/markdown/headings";
import { SOURCE_POSITION_DATASET } from "./source-position-contract";

// NOTE: Never mutate the Text node contents under a heading element. Lexical
// reconciles from its internal state into the DOM, and its MutationObserver
// reads DOM text back into state. Stripping the Pandoc attribute suffix from
// the rendered text causes the next keystroke to push the stripped text back
// into the Lexical TextNode, silently losing the authored `{-}` /
// `{.unnumbered}` / `{#id}` attribute block (issue #98). Only set data-*
// attributes here; visual treatment of the attribute suffix belongs to CSS.
export function syncHeadingChrome(root: HTMLElement | null, doc: string): void {
  if (!root) {
    return;
  }

  const headings = extractHeadingDefinitions(doc);
  const elements = [...root.querySelectorAll<HTMLElement>(".cf-lexical-heading")];

  for (const element of elements) {
    delete element.dataset[SOURCE_POSITION_DATASET.headingNumber];
  }

  elements.forEach((element, index) => {
    const heading = headings[index];
    if (!heading) {
      return;
    }

    element.dataset[SOURCE_POSITION_DATASET.headingPos] = String(heading.pos);

    if (heading.number) {
      element.dataset[SOURCE_POSITION_DATASET.headingNumber] = heading.number;
    }
  });
}
