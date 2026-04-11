import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { $isHeadingNode } from "@lexical/rich-text";

import {
  extractLabelId,
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
  headingEntriesEqual,
  type HeadingEntry,
} from "../app/markdown/headings";
import { useHeadingIndexStore } from "../app/stores/heading-index-store";

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
 * the DOM (set by HeadingChromePlugin via data-coflat-heading-pos).
 */
function mergeWithDomPositions(
  entries: Omit<HeadingEntry, "pos">[],
  root: HTMLElement | null,
): HeadingEntry[] {
  if (!root) {
    return entries.map((e, i) => ({ ...e, pos: i }));
  }

  const elements = [...root.querySelectorAll<HTMLElement>(".cf-lexical-heading[data-coflat-heading-pos]")];
  return entries.map((entry, i) => {
    const el = elements[i];
    const pos = el ? Number(el.dataset.coflatHeadingPos ?? i) : i;
    return { ...entry, pos: Number.isFinite(pos) ? pos : i };
  });
}

/**
 * Lexical plugin that maintains a live heading index in a Zustand store.
 *
 * Listens for editor updates and rebuilds the heading index from the
 * Lexical tree. Heading structure (level, text, numbering) comes from
 * HeadingNodes; source-position (`pos`) comes from the DOM attributes
 * set by HeadingChromePlugin.
 */
export function HeadingIndexPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const store = useHeadingIndexStore;
    let prev: HeadingEntry[] = [];

    const sync = () => {
      let entries: Omit<HeadingEntry, "pos">[] = [];
      editor.read(() => {
        entries = $collectHeadingEntries();
      });
      const headings = mergeWithDomPositions(entries, editor.getRootElement());
      if (!headingEntriesEqual(prev, headings)) {
        prev = headings;
        store.getState().setHeadings(headings);
      }
    };

    // Initial sync
    sync();

    const unregister = editor.registerUpdateListener(() => {
      sync();
    });

    return () => {
      unregister();
      store.getState().reset();
    };
  }, [editor]);

  return null;
}
