/**
 * CommandPalette — React modal command palette built on cmdk.
 *
 * Renders a Command.Dialog with search input, category-grouped items,
 * and keyboard navigation. Toggle via Cmd+P (wired in the parent).
 */

import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useMemo, type ReactNode } from "react";

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

function ShortcutBadge({ shortcut }: { shortcut: string }): ReactNode {
  return (
    <span className="ml-auto flex items-center gap-1 shrink-0">
      {shortcut.split("+").map((key) => (
        <kbd
          key={key}
          className="inline-flex items-center justify-center rounded border border-[var(--cg-border)] bg-[var(--cg-subtle)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--cg-muted)] leading-none"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

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
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command Palette"
      // Overlay: fixed, full-screen semi-transparent backdrop
      overlayClassName={[
        "fixed inset-0 z-50",
        "bg-black/40",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
      ].join(" ")}
      // Panel: centered card — borders for depth, no shadows
      className={[
        "fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2",
        "rounded-lg border border-[var(--cg-border)]",
        "bg-[var(--cg-bg)] text-[var(--cg-fg)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
      ].join(" ")}
    >
      {/* Search input */}
      <div className="flex items-center border-b border-[var(--cg-border)] px-3">
        <Search
          className="mr-2 h-4 w-4 shrink-0 text-[var(--cg-muted)]"
          aria-hidden="true"
        />
        <Command.Input
          placeholder="Type a command..."
          className={[
            "flex h-11 w-full bg-transparent py-3 text-sm outline-none",
            "placeholder:text-[var(--cg-muted)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          ].join(" ")}
        />
      </div>

      {/* Results list */}
      <Command.List className="max-h-[320px] overflow-y-auto overflow-x-hidden p-2">
        <Command.Empty className="py-6 text-center text-sm text-[var(--cg-muted)]">
          No commands found.
        </Command.Empty>

        {Array.from(groups.entries()).map(([category, items]) => (
          <Command.Group
            key={category}
            heading={category}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--cg-muted)]"
          >
            {items.map((cmd) => (
              <Command.Item
                key={cmd.id}
                value={`${cmd.label} ${cmd.category ?? ""}`}
                onSelect={() => {
                  onOpenChange(false);
                  cmd.action();
                }}
                className={[
                  "relative flex cursor-pointer select-none items-center rounded-md px-2 py-2 text-sm",
                  "text-[var(--cg-fg)] outline-none",
                  "aria-selected:bg-[var(--cg-accent)] aria-selected:text-[var(--cg-accent-fg)]",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                ].join(" ")}
              >
                <span className="truncate">{cmd.label}</span>
                {cmd.shortcut && <ShortcutBadge shortcut={cmd.shortcut} />}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>

      {/* Footer hint */}
      <div className="border-t border-[var(--cg-border)] px-3 py-2 flex items-center gap-3 text-[10px] text-[var(--cg-muted)]">
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
    </Command.Dialog>
  );
}
