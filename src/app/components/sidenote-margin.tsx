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
import { createPortal } from "react-dom";
import { EditorView } from "@codemirror/view";
import { collectFootnotes, mathMacrosField } from "../../render";
import { serializeMacros } from "../../render/render-core";
import { orderedFootnoteEntries } from "../../semantics/document";
import { renderDocumentFragmentToDom } from "../../document-surfaces";

interface SidenoteEntry {
  id: string;
  number: number;
  content: string;
  /** Y of the footnote ref in the editor (px, relative to document top). */
  anchorY: number;
  /** Start position of the footnote definition in the document (for click-to-edit). */
  defFrom: number;
}

interface SidenoteMarginProps {
  view: EditorView | null;
  revision: number;
}

const GAP = 8;
const ESTIMATED_SIDENOTE_HEIGHT = 40;
const EMPTY_MACROS: Record<string, string> = {};

type MeasurableSidenoteElement = Pick<HTMLDivElement, "offsetHeight">;

function extractSidenotes(view: EditorView): SidenoteEntry[] {
  const state = view.state;
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

    // lineBlockAt returns document-coordinate top that works for off-screen positions
    const block = view.lineBlockAt(refFrom);
    const anchorY = block.top;

    entries.push({
      id: entry.id,
      number: entry.number,
      content: entry.def.content,
      anchorY,
      defFrom: entry.def.from,
    });
  }

  entries.sort((a, b) => a.anchorY - b.anchorY);
  return entries;
}

export function findFirstSidenoteLayoutChange(
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
      || before.anchorY !== after.anchorY
      || before.defFrom !== after.defFrom
    ) {
      return index;
    }
  }

  return previous.length === next.length ? -1 : sharedLength;
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

  let nextAvailableY = 0;
  if (normalizedStartIndex > 0) {
    const previousEntry = entries[normalizedStartIndex - 1];
    const previousTop = result[normalizedStartIndex - 1] ?? previousEntry.anchorY;
    const previousHeight = itemRefs.get(previousEntry.id)?.offsetHeight ?? ESTIMATED_SIDENOTE_HEIGHT;
    nextAvailableY = previousTop + previousHeight + GAP;
  }

  for (let index = normalizedStartIndex; index < entries.length; index += 1) {
    const entry = entries[index];
    const top = Math.max(entry.anchorY, nextAvailableY);
    result[index] = top;

    const height = itemRefs.get(entry.id)?.offsetHeight ?? ESTIMATED_SIDENOTE_HEIGHT;
    nextAvailableY = top + height + GAP;
  }

  return result;
}

function samePositions(previous: readonly number[], next: readonly number[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
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

export function SidenoteMargin({ view, revision }: SidenoteMarginProps) {
  const [positions, setPositions] = useState<number[]>([]);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const previousEntriesRef = useRef<readonly SidenoteEntry[]>([]);
  const previousMacrosKeyRef = useRef("");
  const positionsRef = useRef<number[]>([]);

  // Create a container div inside the CM6 scroller for our sidenotes
  useEffect(() => {
    if (!view) {
      setPortalTarget(null);
      return;
    }

    const scroller = view.scrollDOM;
    // Check if we already have a container
    let container = scroller.querySelector(".cf-sidenote-portal") as HTMLDivElement | null;
    if (!container) {
      container = document.createElement("div");
      container.className = "cf-sidenote-portal";
      scroller.style.position = "relative";
      scroller.appendChild(container);
    }

    setPortalTarget(container);

    return () => {
      // Clean up on unmount
      if (container && container.parentElement) {
        container.parentElement.removeChild(container);
      }
    };
  }, [view]);

  const entries = useMemo(() => {
    if (!view) return [];
    return extractSidenotes(view);
  }, [view, revision]);

  const macros = useMemo(() => {
    if (!view) return EMPTY_MACROS;
    return view.state.field(mathMacrosField, false) ?? {};
  }, [view, revision]);
  const macrosKey = useMemo(() => serializeMacros(macros), [macros]);

  const setItemRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(id, el);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  // Recompute positions from the first changed sidenote only. Earlier
  // entries keep their previous placement and do not need to be remeasured.
  useEffect(() => {
    if (entries.length === 0) {
      previousEntriesRef.current = entries;
      previousMacrosKeyRef.current = macrosKey;
      positionsRef.current = [];
      setPositions((current) => (current.length === 0 ? current : []));
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const previousEntries = previousEntriesRef.current;
      const previousPositions = positionsRef.current;
      const fullRemeasure = previousMacrosKeyRef.current !== macrosKey;
      const changedIndex = fullRemeasure
        ? 0
        : findFirstSidenoteLayoutChange(previousEntries, entries);

      if (changedIndex === -1 && previousPositions.length === entries.length) {
        previousEntriesRef.current = entries;
        previousMacrosKeyRef.current = macrosKey;
        return;
      }

      const nextPositions = measureSidenotePositions(
        entries,
        itemRefs.current,
        previousPositions,
        changedIndex,
      );

      previousEntriesRef.current = entries;
      previousMacrosKeyRef.current = macrosKey;
      positionsRef.current = nextPositions;

      setPositions((current) => (samePositions(current, nextPositions) ? current : nextPositions));
    });

    return () => cancelAnimationFrame(rafId);
  }, [entries, macrosKey]);

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
              // Focus first so the editor knows it's focused when rebuilding decorations
              view.focus();
              // Place cursor at the definition line — this triggers decoration rebuild
              // which un-collapses the line since cursor is now inside the def range
              view.dispatch({
                selection: { anchor: entry.defFrom },
              });
              // Scroll after the line has been un-collapsed (next frame)
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
