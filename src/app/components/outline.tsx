interface HeadingEntry {
  level: number;
  text: string;
  from: number;
}

interface OutlineProps {
  headings: HeadingEntry[];
  onSelect: (from: number) => void;
}

/**
 * Document outline panel.
 * Renders heading hierarchy with indentation by level.
 * Clicking a heading calls onSelect with the character position.
 */
export function Outline({ headings, onSelect }: OutlineProps) {
  if (headings.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cg-muted)] italic">
        No headings
      </div>
    );
  }

  return (
    <div className="py-1">
      {headings.map((heading, i) => {
        // Indentation: each level adds 12px, base offset 8px
        const indent = (heading.level - 1) * 12 + 8;

        return (
          <button
            key={i}
            className="w-full text-left flex items-baseline gap-1 py-[2px] text-sm text-[var(--cg-fg)] hover:bg-[var(--cg-hover,rgba(0,0,0,.06))] cursor-pointer truncate"
            style={{ paddingLeft: `${indent}px`, paddingRight: "8px" }}
            onClick={() => onSelect(heading.from)}
            title={heading.text}
          >
            <span className="text-[10px] text-[var(--cg-muted)] shrink-0 font-mono">
              {"#".repeat(heading.level)}
            </span>
            <span className="truncate font-mono">{heading.text}</span>
          </button>
        );
      })}
    </div>
  );
}
