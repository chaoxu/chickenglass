/**
 * Keyboard shortcuts reference dialog React component.
 *
 * Searchable table of keyboard shortcuts organized by category.
 * Closes on Escape or backdrop click.
 */

import { Fragment, useState, useEffect } from "react";

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

  // Reset search on open; close on Escape.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

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
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-lg shadow-2xl w-[520px] max-w-[95vw] max-h-[80vh] flex flex-col outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 shrink-0">
          <h2 className="text-base font-semibold text-zinc-900">Keyboard Shortcuts</h2>
          <button
            type="button"
            className="text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 rounded px-2 py-0.5 text-xl leading-none"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-zinc-100 shrink-0">
          <input
            type="search"
            className="w-full text-sm px-3 py-1.5 rounded border border-zinc-200 outline-none focus:border-blue-400 bg-zinc-50 placeholder:text-zinc-400"
            placeholder="Filter shortcuts…"
            aria-label="Filter shortcuts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-400 italic text-center py-4">
              No shortcuts match your search.
            </p>
          ) : (
            filtered.map((cat) => (
              <section key={cat.name} className="mb-4 last:mb-0">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
                  {cat.name}
                </h3>
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5">
                  {cat.items.map((item) => (
                    <Fragment key={item.label}>
                      <dt className="text-sm text-zinc-700">
                        {item.label}
                      </dt>
                      <dd className="text-sm text-right text-zinc-500 font-mono flex items-center justify-end gap-0.5">
                        {item.keys.split("+").map((part, i, arr) => (
                          <span key={i} className="flex items-center gap-0.5">
                            <kbd className="px-1.5 py-0.5 text-[11px] bg-zinc-100 border border-zinc-200 rounded font-sans">
                              {part}
                            </kbd>
                            {i < arr.length - 1 && (
                              <span className="text-zinc-400 text-xs">+</span>
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
        <div className="px-5 py-2 border-t border-zinc-100 text-xs text-zinc-400 text-center shrink-0">
          Press Escape to close
        </div>
      </div>
    </div>
  );
}
