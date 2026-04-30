import type { SessionDocument } from "./editor-session-model";
import type { UnsavedChangesRequest } from "./unsaved-changes";
import { basename, dirname } from "./lib/utils";

export function makeTransitionRequest(
  currentDocument: SessionDocument,
  reason: UnsavedChangesRequest["reason"],
  target?: { path?: string; name: string },
): UnsavedChangesRequest {
  return {
    reason,
    currentDocument: {
      path: currentDocument.path,
      name: currentDocument.name,
    },
    target,
  };
}

export function pathAffectsDocument(changedPath: string, documentPath: string): boolean {
  return documentPath === changedPath || (
    changedPath !== "" && documentPath.startsWith(`${changedPath}/`)
  );
}

export function nextGeneratedPath(basePath: string, suffix: number): string {
  const directory = dirname(basePath);
  const fileName = basename(basePath);
  const dotIndex = fileName.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const nextName = hasExtension
    ? `${fileName.slice(0, dotIndex)} (${suffix})${fileName.slice(dotIndex)}`
    : `${fileName} (${suffix})`;
  return directory ? `${directory}/${nextName}` : nextName;
}
