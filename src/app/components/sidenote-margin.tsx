/**
 * SidenoteMargin — Gwern-style margin column for footnote sidenotes.
 *
 * Renders footnotes as a stacked list in a fixed-width column to the right
 * of the editor. Each sidenote is positioned near its anchor line (the
 * footnote ref in the text) but never overlaps — they flow top-to-bottom
 * like a regular list with gaps.
 *
 * This replaces the old approach of absolute-positioned widgets inside
 * the CM6 editor DOM, which caused overlap issues and one-frame flashes.
 */

import { useEffect, useRef, useState, useMemo } from "react";
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
  /** Y position of the footnote ref in the editor (px, relative to scroller top). */
  anchorY: number;
}

interface SidenoteMarginProps {
  view: EditorView | null;
  scrollTop: number;
}

/** Minimum gap between stacked sidenotes (px). */
const GAP = 8;

/** Extract sidenote data from CM6 state + compute anchor positions. */
function extractSidenotes(view: EditorView): SidenoteEntry[] {
  const state = view.state;
  const { refs, defs } = collectFootnotes(state);

  // Number footnotes in order of first ref appearance
  const numberMap = new Map<string, number>();
  let nextNum = 1;
  for (const ref of refs) {
    if (!numberMap.has(ref.id)) {
      numberMap.set(ref.id, nextNum++);
    }
  }

  // Build entries with anchor Y positions
  const entries: SidenoteEntry[] = [];
  const scrollerRect = view.scrollDOM.getBoundingClientRect();

  for (const ref of refs) {
    const def = defs.get(ref.id);
    if (!def) continue;
    // Skip duplicate refs for the same footnote
    if (entries.some((e) => e.id === ref.id)) continue;

    const num = numberMap.get(ref.id) ?? 0;

    // Get the Y position of the ref in the editor
    const coords = view.coordsAtPos(ref.from);
    const anchorY = coords ? coords.top - scrollerRect.top + view.scrollDOM.scrollTop : 0;

    entries.push({
      id: ref.id,
      number: num,
      content: def.content,
      anchorY,
    });
  }

  // Sort by anchor position
  entries.sort((a, b) => a.anchorY - b.anchorY);
  return entries;
}

/** Render sidenote content with inline math via KaTeX. */
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract sidenotes whenever view state or scroll changes
  useEffect(() => {
    if (!view) {
      setEntries([]);
      return;
    }
    setEntries(extractSidenotes(view));
  }, [view, scrollTop, view?.state.doc.length]);

  // Get macros from CM6 state
  const macros = useMemo(() => {
    if (!view) return {};
    return getMathMacros(view.state);
  }, [view, view?.state.doc.length]);

  // Compute stacked positions: each sidenote goes at max(anchor, prevBottom + gap)
  const positions = useMemo(() => {
    const result: number[] = [];
    let nextAvailableY = 0;
    for (const entry of entries) {
      const y = Math.max(entry.anchorY, nextAvailableY);
      result.push(y);
      // Estimate height: ~20px per line, ~60 chars per line
      const estimatedLines = Math.ceil(entry.content.length / 50);
      const estimatedHeight = Math.max(20, estimatedLines * 18);
      nextAvailableY = y + estimatedHeight + GAP;
    }
    return result;
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-0 w-56 pointer-events-none select-none"
      style={{ transform: `translateX(100%)` }}
    >
      {entries.map((entry, i) => (
        <div
          key={entry.id}
          className="absolute right-0 w-56 text-xs leading-relaxed text-[var(--cg-muted)] pointer-events-auto"
          style={{
            top: `${positions[i]}px`,
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
