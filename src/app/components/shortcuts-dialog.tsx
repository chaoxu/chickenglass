/**
 * Keyboard shortcuts reference dialog React component.
 *
 * Searchable table of keyboard shortcuts organized by category.
 * Uses the shared app dialog primitives for escape, focus trap, and overlay.
 */

import { Fragment, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

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
      { label: "Insert inline math", keys: "Type $...$" },
      { label: "Insert display math", keys: "Type $$ then Enter" },
      { label: "Insert theorem-like block", keys: "Type ::: {.theorem} then Enter" },
      { label: "Insert table", keys: "Type header + divider, then Enter" },
      { label: "Insert frontmatter", keys: "Type --- at top, then Enter" },
      { label: "Edit block structure", keys: "Click block label or title shell" },
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] w-[520px] max-w-[95vw] flex-col overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogCloseButton aria-label="Close keyboard shortcuts" />
        </DialogHeader>

        <div className="shrink-0 border-b border-[var(--cf-border)] px-4 py-2">
          <Input
            type="search"
            className="bg-[var(--cf-bg-secondary)]"
            placeholder="Filter shortcuts..."
            aria-label="Filter shortcuts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <DialogBody className="flex-1 p-0">
          <ScrollArea className="h-full" viewportClassName="px-4 py-3">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-sm italic text-[var(--cf-muted)]">
                No shortcuts match your search.
              </p>
            ) : (
              filtered.map((cat) => (
                <section key={cat.name} className="mb-4 last:mb-0">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--cf-muted)]">
                    {cat.name}
                  </h3>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5">
                    {cat.items.map((item) => (
                      <Fragment key={item.label}>
                        <dt className="text-sm text-[var(--cf-fg)]">
                          {item.label}
                        </dt>
                        <dd className="flex items-center justify-end gap-0.5 text-right font-mono text-sm text-[var(--cf-muted)]">
                          {item.keys.split("+").map((part, i, arr) => (
                            <span key={i} className="flex items-center gap-0.5">
                              <kbd className="rounded border border-[var(--cf-border)] bg-[var(--cf-bg-secondary)] px-1.5 py-0.5 text-[11px] font-sans text-[var(--cf-fg)]">
                                {part}
                              </kbd>
                              {i < arr.length - 1 && (
                                <span className="text-xs text-[var(--cf-muted)]">+</span>
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
          </ScrollArea>
        </DialogBody>

        <DialogFooter className="justify-center py-2 text-center text-xs text-[var(--cf-muted)]">
          Press Escape to close
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
