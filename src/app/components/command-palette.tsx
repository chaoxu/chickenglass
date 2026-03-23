/**
 * CommandPalette — React modal command palette built on cmdk.
 *
 * Renders a Command.Dialog with search input, category-grouped items,
 * and keyboard navigation. Toggle via Cmd+P (wired in the parent).
 *
 * ## Fuzzy search
 *
 * cmdk includes a built-in fuzzy scoring algorithm (a bundled variant of
 * `command-score`) that handles typo-tolerant, order-preserving character
 * matching with bonuses for word-boundary hits. This makes fuse.js
 * unnecessary for command palette filtering:
 *
 * - **Redundancy**: cmdk already does fuzzy matching out of the box.
 *   Adding fuse.js (~40 KB) would duplicate functionality with no benefit.
 * - **Bundle cost**: 40 KB is significant for a desktop/web editor that
 *   ships ~20 commands. The built-in scorer is <1 KB (inlined in cmdk).
 * - **Integration friction**: Using fuse.js would require disabling cmdk's
 *   built-in filter (`shouldFilter={false}`) and manually managing item
 *   visibility and ordering, losing cmdk's optimized DOM diffing.
 * - **Scale**: The palette has ~25 static commands. Even exact substring
 *   matching would be adequate at this scale; fuzzy matching is a bonus
 *   we already get for free.
 *
 * The search panel (`search-panel.tsx`) uses a separate backend-style
 * indexer query (label/content search via BackgroundIndexer) and does not
 * need client-side fuzzy matching either.
 *
 * Decision: fuse.js rejected — cmdk's built-in fuzzy search is sufficient.
 * Evaluated 2026-03-19, issue #194.
 */

import { memo, useMemo, type ReactNode } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./ui/command";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single command entry shown in the palette. */
export interface PaletteCommand {
  /** Unique identifier. */
  id: string;
  /** Display label shown in the list. */
  label: string;
  /** Optional category string used for grouping. */
  category?: string;
  /** Optional keyboard shortcut hint (display only). */
  shortcut?: string;
  /** Action executed when the item is selected. */
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Group commands by category, preserving insertion order. */
function groupByCategory(
  commands: PaletteCommand[],
): Map<string, PaletteCommand[]> {
  const groups = new Map<string, PaletteCommand[]>();
  for (const cmd of commands) {
    const key = cmd.category ?? "General";
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(cmd);
    } else {
      groups.set(key, [cmd]);
    }
  }
  return groups;
}

// ── Shortcut badge ─────────────────────────────────────────────────────────────

const ShortcutBadge = memo(function ShortcutBadge({ shortcut }: { shortcut: string }): ReactNode {
  return (
    <CommandShortcut>
      {shortcut.split("+").map((key) => (
        <kbd
          key={key}
          className="inline-flex items-center justify-center rounded border border-[var(--cf-border)] bg-[var(--cf-subtle)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--cf-muted)] leading-none"
        >
          {key}
        </kbd>
      ))}
    </CommandShortcut>
  );
});

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Modal command palette dialog.
 *
 * - `open` / `onOpenChange`: controlled visibility (parent owns state).
 * - `commands`: flat list; grouped by `category` field.
 * - Cmd+P toggle should be wired in the parent component.
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: CommandPaletteProps): ReactNode {
  const groups = useMemo(() => groupByCategory(commands), [commands]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="top-[20%] w-full max-w-lg -translate-y-0"
    >
      <CommandInput placeholder="Type a command..." />

      <CommandList>
        <CommandEmpty>
          No commands found.
        </CommandEmpty>

        {Array.from(groups.entries()).map(([category, items]) => (
          <CommandGroup
            key={category}
            heading={category}
          >
            {items.map((cmd) => (
              <CommandItem
                key={cmd.id}
                value={`${cmd.label} ${cmd.category ?? ""}`}
                onSelect={() => {
                  onOpenChange(false);
                  cmd.action();
                }}
              >
                <span className="truncate">{cmd.label}</span>
                {cmd.shortcut && <ShortcutBadge shortcut={cmd.shortcut} />}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>

      {/* Footer hint */}
      <div className="border-t border-[var(--cf-border)] px-3 py-2 flex items-center gap-3 text-[10px] text-[var(--cf-muted)]">
        <span>
          <kbd className="font-mono">↑↓</kbd> navigate
        </span>
        <span>
          <kbd className="font-mono">↵</kbd> select
        </span>
        <span>
          <kbd className="font-mono">Esc</kbd> close
        </span>
      </div>
    </CommandDialog>
  );
}
