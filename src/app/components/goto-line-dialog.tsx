/**
 * Go-to-line dialog React component.
 *
 * Small input dialog that accepts "line" or "line:column".
 * Enter confirms, Escape or backdrop click dismisses.
 * Uses @radix-ui/react-dialog for escape, focus trap, and overlay.
 */

import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { parseTarget } from "../goto-line";

interface GotoLineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGoto: (line: number, col?: number) => void;
  currentLine: number;
}

export function GotoLineDialog({ open, onOpenChange, onGoto, currentLine }: GotoLineDialogProps) {
  const [value, setValue] = useState("");

  // Reset value when opened.
  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  const commit = () => {
    const raw = value.trim() || String(currentLine);
    const target = parseTarget(raw);
    if (target) {
      onGoto(target.line, target.col);
    }
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[10000]" />
        <Dialog.Content
          className="fixed left-1/2 top-24 z-[10000] -translate-x-1/2 bg-[var(--cg-bg)] rounded-lg border border-[var(--cg-border)] w-72 p-3 outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Go to line</Dialog.Title>
          <input
            type="text"
            className="w-full text-sm px-3 py-1.5 rounded border border-[var(--cg-border)] outline-none focus:ring-1 focus:ring-[var(--cg-accent)] bg-[var(--cg-bg-secondary)] placeholder:text-[var(--cg-muted)] text-[var(--cg-fg)] font-mono"
            placeholder={String(currentLine)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Go to line"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          <p className="mt-1.5 text-[11px] text-[var(--cg-muted)] leading-tight">
            line or line:column -- Enter to jump, Esc to dismiss
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
