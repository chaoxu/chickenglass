import { memo, useState, useCallback } from "react";
import type { HeadingEntry } from "../heading-ancestry";
import { renderDocumentFragmentToHtml } from "../../document-surfaces";

interface OutlineProps {
  headings: HeadingEntry[];
  onSelect: (from: number) => void;
}

/**
 * Document outline panel with collapsible sections.
 * Clicking the toggle arrow collapses/expands child headings.
 * Clicking the heading text navigates to it in the editor.
 */
export const Outline = memo(function Outline({ headings, onSelect }: OutlineProps) {
  // Set of heading indices that are collapsed (their children are hidden)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const toggleCollapse = useCallback((index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  if (headings.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cf-muted)] italic">
        No headings
      </div>
    );
  }

  // Determine which headings are visible (not hidden by a collapsed parent)
  const visible: boolean[] = new Array(headings.length).fill(true);
  for (let i = 0; i < headings.length; i++) {
    if (!visible[i]) continue;
    if (!collapsed.has(i)) continue;
    // This heading is collapsed — hide all subsequent headings with higher level
    const parentLevel = headings[i].level;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= parentLevel) break;
      visible[j] = false;
    }
  }

  // Check if a heading has children (next heading has higher level number)
  const hasChildren = (index: number): boolean => {
    if (index + 1 >= headings.length) return false;
    return headings[index + 1].level > headings[index].level;
  };

  return (
    <div className="py-1">
      {headings.map((heading, i) => {
        if (!visible[i]) return null;

        const indent = (heading.level - 1) * 12 + 8;
        const canCollapse = hasChildren(i);
        const isCollapsed = collapsed.has(i);

        return (
          <div
            key={i}
            className="flex items-baseline w-full hover:bg-[var(--cf-hover)] transition-colors duration-[var(--cf-transition,0.15s)]"
            style={{ paddingLeft: `${indent}px`, paddingRight: "8px" }}
          >
            {/* Collapse toggle */}
            <button
              className="shrink-0 w-4 text-[10px] text-[var(--cf-muted)] font-mono leading-none cursor-pointer select-none"
              onClick={(e) => {
                e.stopPropagation();
                if (canCollapse) toggleCollapse(i);
              }}
              style={{ visibility: canCollapse ? "visible" : "hidden" }}
              aria-label={isCollapsed ? "Expand section" : "Collapse section"}
            >
              {isCollapsed ? "▶" : "▼"}
            </button>
            {/* Heading text — click to navigate */}
            <button
              className="flex-1 text-left flex items-baseline gap-1 py-[2px] text-sm text-[var(--cf-fg)] cursor-pointer truncate min-w-0"
              onClick={() => onSelect(heading.pos)}
            >
              <span className="text-[10px] text-[var(--cf-muted)] shrink-0 font-mono tabular-nums">
                {heading.number}
              </span>
              <span
                className="truncate cf-ui-font"
                dangerouslySetInnerHTML={{ __html: renderDocumentFragmentToHtml({ kind: "chrome-label", text: heading.text }) }}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
});
