import { $getRoot } from "lexical";
import { $isHeadingNode } from "@lexical/rich-text";

import {
  extractLabelId,
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
  type HeadingEntry,
} from "../app/markdown/headings";
import {
  HEADING_SOURCE_SELECTOR,
  SOURCE_POSITION_DATASET,
} from "./source-position-contract";

const TAG_TO_LEVEL: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

/**
 * Walk the Lexical root and build a HeadingEntry[] from HeadingNodes.
 *
 * Must be called inside editor.read() or editor.update().
 * Returns entries without `pos` — the caller must fill those in from
 * the DOM after reading the editor state.
 */
export function $collectHeadingEntries(): Omit<HeadingEntry, "pos">[] {
  const root = $getRoot();
  const children = root.getChildren();
  const counters = [0, 0, 0, 0, 0, 0];
  const entries: Omit<HeadingEntry, "pos">[] = [];

  for (const child of children) {
    if (!$isHeadingNode(child)) {
      continue;
    }

    const level = TAG_TO_LEVEL[child.getTag()] ?? 1;
    const rawText = child.getTextContent();
    const attrs = findTrailingHeadingAttributes(rawText);
    const text = (
      attrs ? rawText.slice(0, rawText.lastIndexOf(attrs)) : rawText
    ).trim();
    const unnumbered = hasUnnumberedHeadingAttributes(attrs);

    if (!unnumbered) {
      counters[level - 1] += 1;
      for (let i = level; i < counters.length; i += 1) {
        counters[i] = 0;
      }
    }

    const number = unnumbered
      ? ""
      : counters.slice(0, level).filter((v) => v > 0).join(".");

    const id = extractLabelId(attrs);

    entries.push({ level, text, number, ...(id ? { id } : {}) });
  }

  return entries;
}

/**
 * Merge heading entries from the Lexical tree with `pos` values from
 * the DOM. The `pos` values are written by syncHeadingChrome via the
 * `data-coflat-heading-pos` attribute during the same update tick, so
 * both reads see consistent structure.
 */
export function mergeHeadingDomPositions(
  entries: readonly Omit<HeadingEntry, "pos">[],
  root: HTMLElement | null,
): HeadingEntry[] {
  if (!root) {
    return entries.map((e, i) => ({ ...e, pos: i }));
  }

  const elements = [...root.querySelectorAll<HTMLElement>(HEADING_SOURCE_SELECTOR)];
  return entries.map((entry, i) => {
    const el = elements[i];
    const pos = el ? Number(el.dataset[SOURCE_POSITION_DATASET.headingPos] ?? i) : i;
    return { ...entry, pos: Number.isFinite(pos) ? pos : i };
  });
}
