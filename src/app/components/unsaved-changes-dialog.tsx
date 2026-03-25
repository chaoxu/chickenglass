import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import type { UnsavedChangesRequest } from "../unsaved-changes";

interface UnsavedChangesDialogProps {
  request: UnsavedChangesRequest | null;
  onDecision: (decision: "save" | "discard" | "cancel") => void;
}

function titleForRequest(request: UnsavedChangesRequest): string {
  switch (request.reason) {
    case "close-file":
      return "Save changes before closing?";
    case "close-window":
      return "Save changes before closing the window?";
    case "switch-project":
      return "Save changes before switching folders?";
    case "switch-file":
    default:
      return "Save changes before opening another file?";
  }
}

function descriptionForRequest(request: UnsavedChangesRequest): string {
  const current = request.currentDocument.name;
  if (!request.target) {
    return `"${current}" has unsaved changes.`;
  }

  return `"${current}" has unsaved changes. "${request.target.name}" will replace it in this window.`;
}

export function UnsavedChangesDialog({
  request,
  onDecision,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onDecision("cancel");
      }}
    >
      {request && (
        <DialogContent className="w-[min(92vw,32rem)]">
          <DialogHeader>
            <DialogTitle>{titleForRequest(request)}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <DialogDescription>{descriptionForRequest(request)}</DialogDescription>
            <p className="text-sm text-[var(--cf-muted)]">
              Choose whether to save the current document, discard its unsaved changes, or stay where you are.
            </p>
          </DialogBody>
          <DialogFooter>
            <button
              type="button"
              className="rounded-md border border-[var(--cf-border)] px-3 py-1.5 text-sm text-[var(--cf-muted)] hover:bg-[var(--cf-hover)]"
              onClick={() => { onDecision("cancel"); }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md border border-[var(--cf-border)] px-3 py-1.5 text-sm text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]"
              onClick={() => { onDecision("discard"); }}
            >
              Discard
            </button>
            <button
              type="button"
              className="rounded-md bg-[var(--cf-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              onClick={() => { onDecision("save"); }}
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
