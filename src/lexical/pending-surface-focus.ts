import type { NodeKey } from "lexical";

import type { FocusRequestEdge } from "./editor-focus-plugin";

export type PendingEmbeddedSurfaceFocusTarget =
  | "block-body"
  | "footnote-body"
  | "structure-source";

const pendingSurfaceFocus = new Map<string, FocusRequestEdge>();

export function getPendingEmbeddedSurfaceFocusId(
  editorKey: string,
  nodeKey: NodeKey,
  target: PendingEmbeddedSurfaceFocusTarget,
): string {
  return `${editorKey}:${target}:${nodeKey}`;
}

export function queuePendingSurfaceFocus(
  focusId: string,
  edge: FocusRequestEdge = "current",
): void {
  pendingSurfaceFocus.set(focusId, edge);
}

export function consumePendingSurfaceFocus(
  focusId: string,
): FocusRequestEdge | null {
  const edge = pendingSurfaceFocus.get(focusId);
  if (!edge) {
    return null;
  }

  pendingSurfaceFocus.delete(focusId);
  return edge;
}

export function queueEmbeddedSurfaceFocus(
  editorKey: string,
  nodeKey: NodeKey,
  target: PendingEmbeddedSurfaceFocusTarget,
  edge: FocusRequestEdge = "current",
): void {
  queuePendingSurfaceFocus(
    getPendingEmbeddedSurfaceFocusId(editorKey, nodeKey, target),
    edge,
  );
}
