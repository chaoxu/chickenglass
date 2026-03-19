/**
 * SidenoteMargin — Gwern-style margin column for footnote sidenotes.
 *
 * Two-pass rendering:
 * 1. Render all sidenotes invisibly to measure actual DOM heights
 * 2. Reposition with real heights: each at max(anchor, prevBottom + gap)
 *
 * Sidenotes anchor near their footnote ref line but never overlap.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import {
  collectFootnotes,
  splitByInlineMath,
} from "../../render/sidenote-render";
import katex from "katex";
import { getMathMacros } from "../../render/math-macros";

interface SidenoteEntry {
  id: string;
  number: number;
  content: string;
  /** Y of the footnote ref in the editor (px, relative to document top). */
  anchorY: number;
}

interface SidenoteMarginProps {
  view: EditorView | null;
  scrollTop: number;
}

const GAP = 8;

function extractSidenotes(view: EditorView): SidenoteEntry[] {
  const state = view.state;
  const { refs, defs } = collectFootnotes(state);

  const numberMap = new Map<string, number>();
  let nextNum = 1;
  for (const ref of refs) {
    if (!numberMap.has(ref.id)) numberMap.set(ref.id, nextNum++);
  }

  const entries: SidenoteEntry[] = [];
  const scrollerRect = view.scrollDOM.getBoundingClientRect();

  for (const ref of refs) {
    const def = defs.get(ref.id);
    if (!def) continue;
    if (entries.some((e) => e.id === ref.id)) continue;

    const coords = view.coordsAtPos(ref.from);
    const anchorY = coords
      ? coords.top - scrollerRect.top + view.scrollDOM.scrollTop
      : 0;

    entries.push({
      id: ref.id,
      number: numberMap.get(ref.id) ?? 0,
      content: def.content,
      anchorY,
    });
  }

  entries.sort((a, b) => a.anchorY - b.anchorY);
  return entries;
}

function SidenoteContent({ text, macros }: { text: string; macros: Record<string, string> }) {
  const segments = splitByInlineMath(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.isMath ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(seg.content, {
                throwOnError: false,
                displayMode: false,
                macros,
              }),
            }}
          />
        ) : (
          <span key={i}>{seg.content}</span>
        ),
      )}
    </>
  );
}

export function SidenoteMargin({ view, scrollTop }: SidenoteMarginProps) {
  const [entries, setEntries] = useState<SidenoteEntry[]>([]);
  const [positions, setPositions] = useState<number[]>([]);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract sidenotes whenever view state or scroll changes
  useEffect(() => {
    if (!view) {
      setEntries([]);
      return;
    }
    setEntries(extractSidenotes(view));
  }, [view, scrollTop, view?.state.doc.length]);

  const macros = useMemo(() => {
    if (!view) return {};
    return getMathMacros(view.state);
  }, [view, view?.state.doc.length]);

  // Ref callback to track item elements
  const setItemRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(id, el);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  // Two-pass: after render, measure actual heights and recompute positions
  useEffect(() => {
    if (entries.length === 0) {
      setPositions([]);
      return;
    }

    // Use requestAnimationFrame to measure after browser has painted
    const rafId = requestAnimationFrame(() => {
      const result: number[] = [];
      let nextAvailableY = 0;

      for (const entry of entries) {
        // Anchor Y from the ref position in the editor
        const targetY = Math.max(entry.anchorY, nextAvailableY);
        result.push(targetY);

        // Measure actual rendered height
        const el = itemRefs.current.get(entry.id);
        const actualHeight = el ? el.offsetHeight : 40;
        nextAvailableY = targetY + actualHeight + GAP;
      }

      setPositions(result);
    });

    return () => cancelAnimationFrame(rafId);
  }, [entries]);

  // Sync margin scroll with editor scroll
  useEffect(() => {
    if (!containerRef.current || !view) return;
    containerRef.current.scrollTop = scrollTop;
  }, [scrollTop, view]);

  if (entries.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="w-56 shrink-0 relative overflow-hidden border-l border-[var(--cg-border)] bg-[var(--cg-bg)]"
    >
      {entries.map((entry, i) => (
        <div
          key={entry.id}
          ref={(el) => setItemRef(entry.id, el)}
          className="absolute w-full px-3 text-xs leading-relaxed text-[var(--cg-muted)]"
          style={{
            top: `${positions[i] ?? entry.anchorY}px`,
            fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
          }}
        >
          <span className="font-semibold text-[var(--cg-fg)] text-[0.7em] align-super mr-0.5">
            {entry.number}
          </span>
          <SidenoteContent text={entry.content} macros={macros} />
        </div>
      ))}
    </div>
  );
}
