import type { ReactNode } from "react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import type {
  DocumentLabelBacklinkItem,
  DocumentLabelBacklinksResult,
} from "../../semantics/document-label-backlinks";

interface DocumentLabelBacklinksDialogProps {
  result: DocumentLabelBacklinksResult | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: DocumentLabelBacklinkItem) => void;
}

function describeDefinition(result: DocumentLabelBacklinksResult): string {
  const { definition } = result;
  const parts = [definition.id];

  if (definition.kind === "heading" && definition.title) {
    parts.push(definition.title);
  } else if (definition.kind === "block" && definition.title) {
    parts.push(definition.title);
  } else if (definition.kind === "equation" && definition.text) {
    parts.push(definition.text.replace(/\s+/g, " ").trim());
  }

  return parts.join(" - ");
}

export function DocumentLabelBacklinksDialog({
  result,
  onOpenChange,
  onSelect,
}: DocumentLabelBacklinksDialogProps): ReactNode {
  const open = result !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(42rem,calc(100vw-2rem))] overflow-hidden p-0"
      >
        {result && (
          <>
            <DialogHeader>
              <div className="min-w-0">
                <DialogTitle>
                  References to {result.definition.displayLabel}
                </DialogTitle>
                <DialogDescription className="truncate">
                  {describeDefinition(result)}
                </DialogDescription>
              </div>
              <DialogCloseButton />
            </DialogHeader>
            <DialogBody className="p-0">
              {result.backlinks.length === 0 ? (
                <div className="px-5 py-6 text-sm text-[var(--cf-muted)]">
                  No references to this local label were found in the current document.
                </div>
              ) : (
                <ScrollArea className="max-h-[60vh]">
                  <div className="divide-y divide-[var(--cf-border)]">
                    {result.backlinks.map((item) => (
                      <button
                        key={`${item.from}:${item.to}`}
                        type="button"
                        onClick={() => onSelect(item)}
                        className="block w-full px-5 py-4 text-left transition-colors hover:bg-[var(--cf-hover)]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-[var(--cf-fg)]">
                            Line {item.lineNumber}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--cf-muted)]">
                            {item.referenceText}
                            {item.locator ? ` (${item.locator})` : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--cf-muted)]">
                          {item.contextText}
                        </p>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </DialogBody>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
