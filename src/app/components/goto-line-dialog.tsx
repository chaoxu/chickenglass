/**
 * Go-to-line dialog React component.
 *
 * Small input dialog that accepts "line" or "line:column".
 * Enter confirms, Escape or backdrop click dismisses.
 * Uses the shared app dialog primitives for escape, focus trap, and overlay.
 */

import { useState, useEffect } from "react";
import { parseTarget } from "../goto-line";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-24 w-72 -translate-y-0 p-3"
        aria-describedby={undefined}
        overlayClassName="fixed inset-0 z-[10000] bg-transparent"
      >
        <DialogTitle className="sr-only">Go to line</DialogTitle>
        <input
          type="text"
          className="w-full rounded border border-[var(--cg-border)] bg-[var(--cg-bg-secondary)] px-3 py-1.5 font-mono text-sm text-[var(--cg-fg)] outline-none focus:ring-1 focus:ring-[var(--cg-accent)] placeholder:text-[var(--cg-muted)]"
          placeholder={String(currentLine)}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Go to line"
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        <p className="mt-1.5 text-[11px] leading-tight text-[var(--cg-muted)]">
          line or line:column -- Enter to jump, Esc to dismiss
        </p>
      </DialogContent>
    </Dialog>
  );
}
