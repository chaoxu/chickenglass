/**
 * Keyboard shortcuts reference dialog React component.
 *
 * Searchable table of keyboard shortcuts organized by category.
 * Uses @radix-ui/react-dialog for escape, focus trap, and overlay.
 */

import { Fragment, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface ShortcutItem {
  label: string;
  keys: string;
}

interface ShortcutCategory {
  name: string;
  items: ShortcutItem[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: "File",
    items: [
      { label: "Save file", keys: "Cmd+S" },
      { label: "Export to PDF", keys: "Cmd+Shift+E" },
      { label: "Export to LaTeX", keys: "Cmd+Shift+L" },
    ],
  },
  {
    name: "Edit",
    items: [
      { label: "Undo", keys: "Cmd+Z" },
      { label: "Redo", keys: "Cmd+Shift+Z" },
      { label: "Bold", keys: "Cmd+B" },
      { label: "Italic", keys: "Cmd+I" },
      { label: "Inline code", keys: "Cmd+Shift+K" },
      { label: "Link", keys: "Cmd+K" },
      { label: "Strikethrough", keys: "Cmd+Shift+X" },
      { label: "Highlight", keys: "Cmd+Shift+H" },
    ],
  },
  {
    name: "View",
    items: [
      { label: "Cycle editor mode", keys: "Cmd+Shift+M" },
      { label: "Toggle focus mode", keys: "Cmd+Shift+F" },
      { label: "Toggle debug inspector", keys: "Cmd+Shift+D" },
    ],
  },
  {
    name: "Navigation",
    items: [
      { label: "Command palette", keys: "Cmd+P" },
      { label: "Keyboard shortcuts reference", keys: "Cmd+/" },
      { label: "Jump to source file", keys: "Cmd+Shift+O" },
      { label: "Go to line", keys: "Cmd+G" },
    ],
  },
  {
    name: "Format",
    items: [
      { label: "Insert inline math ($...$)", keys: "via Command Palette" },
      { label: "Insert display math ($$...$$)", keys: "via Command Palette" },
      { label: "Insert Theorem block", keys: "via Command Palette" },
      { label: "Insert Lemma block", keys: "via Command Palette" },
      { label: "Insert Proof block", keys: "via Command Palette" },
      { label: "Insert Definition block", keys: "via Command Palette" },
    ],
  },
];

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const [query, setQuery] = useState("");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) onClose();
    else setQuery("");
  };

  const lq = query.toLowerCase();
  const filtered = SHORTCUT_CATEGORIES.map((cat) => ({
    ...cat,
    items: lq
      ? cat.items.filter(
          (item) =>
            item.label.toLowerCase().includes(lq) ||
            item.keys.toLowerCase().includes(lq),
        )
      : cat.items,
  })).filter((cat) => cat.items.length > 0);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[10000] bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[10000] -translate-x-1/2 -translate-y-1/2 bg-[var(--cg-bg)] rounded-lg border border-[var(--cg-border)] w-[520px] max-w-[95vw] max-h-[80vh] flex flex-col outline-none"
          aria-describedby={undefined}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--cg-border)] shrink-0">
            <Dialog.Title className="text-sm font-semibold text-[var(--cg-fg)]">
              Keyboard Shortcuts
            </Dialog.Title>
            <Dialog.Close
              className="text-[var(--cg-muted)] hover:text-[var(--cg-fg)] hover:bg-[var(--cg-hover)] rounded px-2 py-0.5 text-xl leading-none transition-colors duration-[var(--cg-transition,0.15s)]"
              aria-label="Close"
            >
              ×
            </Dialog.Close>
          </div>

          {/* Search */}
          <div className="px-4 py-2 border-b border-[var(--cg-border)] shrink-0">
            <input
              type="search"
              className="w-full text-sm px-3 py-1.5 rounded border border-[var(--cg-border)] outline-none focus:ring-1 focus:ring-[var(--cg-accent)] bg-[var(--cg-bg-secondary)] placeholder:text-[var(--cg-muted)] text-[var(--cg-fg)]"
              placeholder="Filter shortcuts..."
              aria-label="Filter shortcuts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {filtered.length === 0 ? (
              <p className="text-sm text-[var(--cg-muted)] italic text-center py-4">
                No shortcuts match your search.
              </p>
            ) : (
              filtered.map((cat) => (
                <section key={cat.name} className="mb-4 last:mb-0">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--cg-muted)] mb-2">
                    {cat.name}
                  </h3>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5">
                    {cat.items.map((item) => (
                      <Fragment key={item.label}>
                        <dt className="text-sm text-[var(--cg-fg)]">
                          {item.label}
                        </dt>
                        <dd className="text-sm text-right text-[var(--cg-muted)] font-mono flex items-center justify-end gap-0.5">
                          {item.keys.split("+").map((part, i, arr) => (
                            <span key={i} className="flex items-center gap-0.5">
                              <kbd className="px-1.5 py-0.5 text-[11px] bg-[var(--cg-bg-secondary)] border border-[var(--cg-border)] rounded font-sans text-[var(--cg-fg)]">
                                {part}
                              </kbd>
                              {i < arr.length - 1 && (
                                <span className="text-[var(--cg-muted)] text-xs">+</span>
                              )}
                            </span>
                          ))}
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                </section>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-2 border-t border-[var(--cg-border)] text-xs text-[var(--cg-muted)] text-center shrink-0">
            Press Escape to close
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
