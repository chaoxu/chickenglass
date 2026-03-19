/**
 * Go-to-line dialog React component.
 *
 * Small input dialog that accepts "line" or "line:column".
 * Enter confirms, Escape or backdrop click dismisses.
 */

import { useState, useEffect, useRef } from "react";
import { parseTarget } from "../goto-line";

interface GotoLineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGoto: (line: number, col?: number) => void;
  currentLine: number;
}

export function GotoLineDialog({ open, onOpenChange, onGoto, currentLine }: GotoLineDialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset value, focus input, and register Escape handler when opened.
  useEffect(() => {
    if (!open) return;
    setValue("");
    requestAnimationFrame(() => inputRef.current?.focus());
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  if (!open) return null;

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
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center pt-24"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="bg-white rounded-lg shadow-2xl border border-zinc-200 w-72 p-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Go to line"
      >
        <input
          ref={inputRef}
          type="text"
          className="w-full text-sm px-3 py-1.5 rounded border border-zinc-200 outline-none focus:border-blue-400 bg-zinc-50 placeholder:text-zinc-400 font-mono"
          placeholder={String(currentLine)}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Go to line"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="mt-1.5 text-[11px] text-zinc-400 leading-tight">
          line or line:column — Enter to jump, Esc to dismiss
        </p>
      </div>
    </div>
  );
}
