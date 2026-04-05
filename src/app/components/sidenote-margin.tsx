/**
 * SidenoteMargin — Gwern-style margin column for footnote sidenotes.
 *
 * Renders sidenotes as a React portal INSIDE the CM6 .cm-scroller element.
 * This means sidenotes share the editor's scroll container — mouse wheel
 * scrolling works everywhere and the scrollbar spans the full width.
 *
 * Positions are in document coordinates (px from content top), so they
 * scroll naturally with no manual sync needed.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { EditorState } from "@codemirror/state";
import { createPortal } from "react-dom";
import { EditorView } from "@codemirror/view";
import { collectFootnotes, mathMacrosField } from "../../render";
import { orderedFootnoteEntries } from "../../semantics/document";
import { renderDocumentFragmentToDom } from "../../document-surfaces";

interface SidenoteEntry {
  id: string;
  number: number;
  content: string;
  /** Start position of the first footnote reference in the document. */
  refFrom: number;
  /** Y of the footnote ref in the editor (px, relative to document top). */
  anchorY: number;
  /** Start position of the footnote definition in the document (for click-to-edit). */
  defFrom: number;
}

export interface SidenoteInvalidation {
  revision: number;
  footnotesChanged: boolean;
  macrosChanged: boolean;
  globalLayoutChanged: boolean;
  /** Earliest changed document position in the new doc, or -1 when none. */
  layoutChangeFrom: number;
}

interface SidenoteMarginProps {
  view: EditorView | null;
  invalidation: SidenoteInvalidation;
}

const GAP = 8;
const ESTIMATED_SIDENOTE_HEIGHT = 40;
const EMPTY_MACROS: Record<string, string> = {};

type MeasurableSidenoteElement = Pick<HTMLDivElement, "offsetHeight">;

function collectSidenoteEntries(state: EditorState): SidenoteEntry[] {
  const footnotes = collectFootnotes(state);
  const firstRefById = new Map<string, number>();

  for (const ref of footnotes.refs) {
    if (!firstRefById.has(ref.id)) {
      firstRefById.set(ref.id, ref.from);
    }
  }

  const entries: SidenoteEntry[] = [];
  for (const entry of orderedFootnoteEntries(footnotes)) {
    const refFrom = firstRefById.get(entry.id);
    if (refFrom === undefined) continue;

    entries.push({
      id: entry.id,
      number: entry.number,
      content: entry.def.content,
      refFrom,
      anchorY: 0,
      defFrom: entry.def.from,
    });
  }

  return entries;
}

export function findFirstSidenoteEntryChange(
  previous: readonly SidenoteEntry[],
  next: readonly SidenoteEntry[],
): number {
  const sharedLength = Math.min(previous.length, next.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (
      before.id !== after.id
      || before.number !== after.number
      || before.content !== after.content
      || before.refFrom !== after.refFrom
      || before.defFrom !== after.defFrom
    ) {
      return index;
    }
  }

  return previous.length === next.length ? -1 : sharedLength;
}

export function findFirstSidenoteAnchorChange(
  previous: readonly SidenoteEntry[],
  next: readonly SidenoteEntry[],
): number {
  const sharedLength = Math.min(previous.length, next.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (before.id !== after.id || before.refFrom !== after.refFrom) {
      return index;
    }
  }

  return previous.length === next.length ? -1 : sharedLength;
}

export function findFirstSidenotePlacementChange(
  previous: readonly SidenoteEntry[],
  next: readonly SidenoteEntry[],
): number {
  const sharedLength = Math.min(previous.length, next.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (
      before.id !== after.id
      || before.number !== after.number
      || before.content !== after.content
      || before.refFrom !== after.refFrom
    ) {
      return index;
    }
  }

  return previous.length === next.length ? -1 : sharedLength;
}

export function findFirstAffectedSidenote(
  entries: readonly SidenoteEntry[],
  lineFrom: number,
): number {
  let lo = 0;
  let hi = entries.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].refFrom < lineFrom) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo < entries.length ? lo : -1;
}

export function measureSidenotePositions(
  entries: readonly SidenoteEntry[],
  itemRefs: ReadonlyMap<string, MeasurableSidenoteElement>,
  previousPositions: readonly number[],
  startIndex: number,
): number[] {
  const result = entries.map((entry, index) => previousPositions[index] ?? entry.anchorY);
  const normalizedStartIndex = Math.max(0, startIndex);

  if (entries.length === 0 || normalizedStartIndex >= entries.length) {
    return result;
  }

  const heightStartIndex = normalizedStartIndex > 0 ? normalizedStartIndex - 1 : normalizedStartIndex;
  const measuredHeights = new Array<number>(entries.length);
  // Batch DOM reads before placement math so we do not force layout in the
  // collision-resolution loop.
  for (let index = heightStartIndex; index < entries.length; index += 1) {
    const entry = entries[index];
    measuredHeights[index] = itemRefs.get(entry.id)?.offsetHeight ?? ESTIMATED_SIDENOTE_HEIGHT;
  }

  let nextAvailableY = 0;
  if (normalizedStartIndex > 0) {
    const previousEntry = entries[normalizedStartIndex - 1];
    const previousTop = result[normalizedStartIndex - 1] ?? previousEntry.anchorY;
    const previousHeight = measuredHeights[normalizedStartIndex - 1] ?? ESTIMATED_SIDENOTE_HEIGHT;
    nextAvailableY = previousTop + previousHeight + GAP;
  }

  for (let index = normalizedStartIndex; index < entries.length; index += 1) {
    const entry = entries[index];
    const top = Math.max(entry.anchorY, nextAvailableY);
    result[index] = top;

    const height = measuredHeights[index] ?? ESTIMATED_SIDENOTE_HEIGHT;
    nextAvailableY = top + height + GAP;
  }

  return result;
}

function samePositions(previous: readonly number[], next: readonly number[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function minChangedIndex(...indices: number[]): number {
  let result = -1;
  for (const index of indices) {
    if (index < 0) continue;
    result = result === -1 ? index : Math.min(result, index);
  }
  return result;
}

function copySidenoteAnchors(
  view: EditorView,
  previous: readonly SidenoteEntry[],
  next: readonly SidenoteEntry[],
  startIndex: number,
): readonly SidenoteEntry[] {
  const normalizedStartIndex = Math.max(0, startIndex);

  return next.map((entry, index) => {
    if (startIndex === -1 || index < normalizedStartIndex) {
      const previousEntry = previous[index];
      if (previousEntry) {
        return {
          ...entry,
          anchorY: previousEntry.anchorY,
        };
      }
    }

    return {
      ...entry,
      anchorY: view.lineBlockAt(entry.refFrom).top,
    };
  });
}

/** React wrapper around the shared document-surface renderer. */
function SidenoteContent({ text, macros }: { text: string; macros: Record<string, string> }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";
    renderDocumentFragmentToDom(ref.current, {
      kind: "footnote",
      text,
      macros,
    });
  }, [text, macros]);
  return <span ref={ref} />;
}

export function SidenoteMargin({ view, invalidation }: SidenoteMarginProps) {
  const [entries, setEntries] = useState<readonly SidenoteEntry[]>([]);
  const [positions, setPositions] = useState<number[]>([]);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const [layoutPassRevision, setLayoutPassRevision] = useState(0);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const entriesRef = useRef<readonly SidenoteEntry[]>([]);
  const positionsRef = useRef<number[]>([]);
  const viewRef = useRef<EditorView | null>(null);
  const measureStartIndexRef = useRef(0);

  // Create a container div inside the CM6 scroller for our sidenotes
  useEffect(() => {
    if (!view) {
      setPortalTarget(null);
      return;
    }

    const scroller = view.scrollDOM;
    let container = scroller.querySelector(".cf-sidenote-portal") as HTMLDivElement | null;
    if (!container) {
      container = document.createElement("div");
      container.className = "cf-sidenote-portal";
      scroller.style.position = "relative";
      scroller.appendChild(container);
    }

    setPortalTarget(container);

    return () => {
      if (container && container.parentElement) {
        container.parentElement.removeChild(container);
      }
    };
  }, [view]);

  const macros = useMemo(() => {
    if (!view) return EMPTY_MACROS;
    return view.state.field(mathMacrosField, false) ?? {};
  }, [view, invalidation.revision]);

  const setItemRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(id, el);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  useEffect(() => {
    if (!view) {
      viewRef.current = null;
      itemRefs.current.clear();
      entriesRef.current = [];
      positionsRef.current = [];
      setEntries((current) => (current.length === 0 ? current : []));
      setPositions((current) => (current.length === 0 ? current : []));
      return;
    }

    const viewChanged = viewRef.current !== view;
    const previousEntries = viewChanged ? [] : entriesRef.current;
    const previousPositions = viewChanged ? [] : positionsRef.current;
    const nextStructure = (viewChanged || invalidation.footnotesChanged)
      ? collectSidenoteEntries(view.state)
      : previousEntries;
    const entryChangeIndex = (viewChanged || invalidation.footnotesChanged)
      ? findFirstSidenoteEntryChange(previousEntries, nextStructure)
      : -1;
    const anchorChangeIndex = (viewChanged || invalidation.footnotesChanged)
      ? findFirstSidenoteAnchorChange(previousEntries, nextStructure)
      : -1;
    const placementChangeIndex = (viewChanged || invalidation.footnotesChanged)
      ? findFirstSidenotePlacementChange(previousEntries, nextStructure)
      : -1;
    const layoutLineFrom = invalidation.layoutChangeFrom >= 0
      ? view.lineBlockAt(invalidation.layoutChangeFrom).from
      : -1;
    const docLayoutChangeIndex = layoutLineFrom >= 0
      ? findFirstAffectedSidenote(nextStructure, layoutLineFrom)
      : -1;
    const nextAnchorStartIndex = viewChanged || invalidation.globalLayoutChanged
      ? 0
      : minChangedIndex(anchorChangeIndex, docLayoutChangeIndex);
    const nextEntries = entryChangeIndex === -1 && nextAnchorStartIndex === -1
      ? previousEntries
      : copySidenoteAnchors(view, previousEntries, nextStructure, nextAnchorStartIndex);
    const nextMeasureStartIndex = viewChanged || invalidation.macrosChanged
      ? 0
      : minChangedIndex(nextAnchorStartIndex, placementChangeIndex);

    viewRef.current = view;
    entriesRef.current = nextEntries;
    setEntries((current) => (current === nextEntries ? current : nextEntries));

    if (nextEntries.length === 0) {
      positionsRef.current = [];
      setPositions((current) => (current.length === 0 ? current : []));
      return;
    }

    if (nextMeasureStartIndex === -1 && previousPositions.length === nextEntries.length) {
      positionsRef.current = previousPositions;
      return;
    }

    measureStartIndexRef.current = nextMeasureStartIndex;
    setLayoutPassRevision((value) => value + 1);
  }, [view, invalidation]);

  // Recompute positions from the first changed sidenote only. Earlier
  // entries keep their previous placement and do not need to be remeasured.
  useEffect(() => {
    const currentEntries = entriesRef.current;
    if (currentEntries.length === 0) return;

    const rafId = requestAnimationFrame(() => {
      const nextPositions = measureSidenotePositions(
        currentEntries,
        itemRefs.current,
        positionsRef.current,
        measureStartIndexRef.current,
      );
      positionsRef.current = nextPositions;
      setPositions((current) => (samePositions(current, nextPositions) ? current : nextPositions));
    });

    return () => cancelAnimationFrame(rafId);
  }, [layoutPassRevision]);

  if (!portalTarget || entries.length === 0) return null;

  return createPortal(
    <>
      {entries.map((entry, i) => {
        const docY = positions[i] ?? entry.anchorY;
        return (
          <div
            key={entry.id}
            ref={(el) => setItemRef(entry.id, el)}
            role="button"
            tabIndex={0}
            aria-label={`Footnote ${entry.number}: navigate to definition`}
            onClick={() => {
              if (!view) return;
              view.focus();
              view.dispatch({
                selection: { anchor: entry.defFrom },
              });
              requestAnimationFrame(() => {
                view.dispatch({ effects: EditorView.scrollIntoView(entry.defFrom) });
              });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!view) return;
                view.focus();
                view.dispatch({ selection: { anchor: entry.defFrom } });
                requestAnimationFrame(() => {
                  view.dispatch({ effects: EditorView.scrollIntoView(entry.defFrom) });
                });
              }
            }}
            className="cf-sidenote-entry"
            style={{ top: `${docY}px` }}
          >
            <span className="cf-sidenote-entry-number">
              {entry.number}
            </span>
            <SidenoteContent text={entry.content} macros={macros} />
          </div>
        );
      })}
    </>,
    portalTarget,
  );
}
