export interface ExternalConflictMergeInput {
  base: string;
  disk: string;
  local: string;
}

export interface ExternalConflictMergeResult {
  content: string;
  hasConflictMarkers: boolean;
}

function conflictSection(label: string, content: string): string {
  return `${label}\n${content}${content.endsWith("\n") ? "" : "\n"}`;
}

export function createExternalConflictMergeDocument({
  base,
  disk,
  local,
}: ExternalConflictMergeInput): ExternalConflictMergeResult {
  if (local === disk) {
    return { content: local, hasConflictMarkers: false };
  }
  if (local === base) {
    return { content: disk, hasConflictMarkers: false };
  }
  if (disk === base) {
    return { content: local, hasConflictMarkers: false };
  }

  return {
    content: [
      conflictSection("<<<<<<< Local edits", local),
      conflictSection("||||||| Last saved", base),
      conflictSection("=======", disk),
      ">>>>>>> Disk version\n",
    ].join(""),
    hasConflictMarkers: true,
  };
}
