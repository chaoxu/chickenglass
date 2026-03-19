/**
 * About dialog React component.
 *
 * Simple modal: "Chickenglass v0.1.0", description, credits, GitHub link.
 * Closes on Escape, backdrop click, or the × button.
 */

import { useEffect } from "react";

const GITHUB_URL = "https://github.com/chickenglass/chickenglass";

interface Credit {
  name: string;
  url: string;
}

const CREDITS: Credit[] = [
  { name: "Tauri", url: "https://tauri.app" },
  { name: "CodeMirror", url: "https://codemirror.net" },
  { name: "KaTeX", url: "https://katex.org" },
  { name: "Lezer", url: "https://lezer.codemirror.net" },
  { name: "Pandoc", url: "https://pandoc.org" },
];

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative bg-[var(--cg-bg)] text-[var(--cg-fg)] rounded-lg border border-[var(--cg-border)] px-10 py-8 min-w-[320px] max-w-[480px] w-full outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="About Chickenglass"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          className="absolute top-3 right-3 text-[var(--cg-muted)] hover:text-[var(--cg-fg)] hover:bg-[var(--cg-hover)] rounded px-2 py-0.5 text-xl leading-none transition-colors duration-[var(--cg-transition,0.15s)]"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>

        {/* Header */}
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-base font-semibold">Chickenglass</h2>
          <span className="text-sm text-[var(--cg-muted)]">v0.1.0</span>
        </div>

        {/* Description */}
        <p className="text-[var(--cg-muted)] text-sm mb-5">
          Semantic document editor for mathematical writing.
        </p>

        {/* Credits */}
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--cg-muted)] mb-1.5">
            Built with
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 list-none p-0 m-0">
            {CREDITS.map((c) => (
              <li key={c.name}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--cg-fg)] underline hover:opacity-60 transition-opacity duration-[var(--cg-transition,0.15s)]"
                >
                  {c.name}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--cg-border)] pt-4">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--cg-fg)] underline hover:opacity-60 transition-opacity duration-[var(--cg-transition,0.15s)]"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
