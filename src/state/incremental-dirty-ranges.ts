import type { ChangeSet, Text } from "@codemirror/state";
import {
  documentRangesFromChanges,
  expandChangedDocumentRange,
  expandChangedDocumentRangeToLines,
  mergeDocumentRanges,
  rangeIntersectsDocumentRanges,
  type DocumentRange,
  type DocumentRangeExpander,
} from "../lib/document-ranges";

export type DirtyRange = DocumentRange;
export type DirtyRangeExpander = DocumentRangeExpander;

export function mergeDirtyRanges(ranges: readonly DirtyRange[]): DirtyRange[] {
  return mergeDocumentRanges(ranges);
}

export function dirtyRangesFromChanges(
  changes: ChangeSet,
  expandRange: DirtyRangeExpander,
): DirtyRange[] {
  return documentRangesFromChanges(changes, expandRange);
}

export function expandChangeRange(
  from: number,
  to: number,
): DirtyRange {
  return expandChangedDocumentRange(from, to);
}

export function expandChangeRangeToLines(
  doc: Text,
  from: number,
  to: number,
): DirtyRange {
  return expandChangedDocumentRangeToLines(doc, from, to);
}

export function rangeIntersectsDirtyRanges(
  from: number,
  to: number,
  dirtyRanges: readonly DirtyRange[],
): boolean {
  return rangeIntersectsDocumentRanges(from, to, dirtyRanges);
}
