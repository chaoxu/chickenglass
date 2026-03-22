/**
 * About dialog React component.
 *
 * Simple modal: "Coflat v0.1.0", description, credits, GitHub link.
 * Uses the shared app dialog primitives for escape, focus trap, and overlay.
 */

import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const GITHUB_URL = "https://github.com/chaoxu/coflat";

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
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="min-w-[320px] w-full max-w-[480px]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <div className="flex items-baseline gap-2">
            <DialogTitle className="text-base">Coflat</DialogTitle>
            <span className="text-sm text-[var(--cg-muted)]">v0.1.0</span>
          </div>
          <DialogCloseButton aria-label="Close about dialog" />
        </DialogHeader>

        <DialogBody className="space-y-5 px-10 py-6">
          <DialogDescription>
            Semantic document editor for mathematical writing.
          </DialogDescription>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-[var(--cg-muted)]">
              Built with
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
              {CREDITS.map((c) => (
                <li key={c.name}>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--cg-fg)] underline transition-opacity duration-[var(--cg-transition,0.15s)] hover:opacity-60"
                  >
                    {c.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </DialogBody>

        <DialogFooter className="justify-start px-10">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--cg-fg)] underline transition-opacity duration-[var(--cg-transition,0.15s)] hover:opacity-60"
          >
            View on GitHub
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
