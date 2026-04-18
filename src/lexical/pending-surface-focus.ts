import type { NodeKey } from "lexical";

import type { FocusRequestEdge } from "./editor-focus-plugin";

export type PendingSurfaceFocusRequest =
  | FocusRequestEdge
  | { readonly offset: number };

export type PendingEmbeddedSurfaceFocusTarget =
  | "block-body"
  | "footnote-body"
  | "structure-source";

const pendingSurfaceFocus = new Map<string, PendingSurfaceFocusRequest>();

export function getPendingEmbeddedSurfaceFocusId(
  editorKey: string,
  nodeKey: NodeKey,
  target: PendingEmbeddedSurfaceFocusTarget,
): string {
  return `${editorKey}:${target}:${nodeKey}`;
}

export function queuePendingSurfaceFocus(
  focusId: string,
  request: PendingSurfaceFocusRequest = "current",
): void {
  pendingSurfaceFocus.set(focusId, request);
}

export function consumePendingSurfaceFocus(
  focusId: string,
): PendingSurfaceFocusRequest | null {
  const request = pendingSurfaceFocus.get(focusId);
  if (!request) {
    return null;
  }

  pendingSurfaceFocus.delete(focusId);
  return request;
}

export function queueEmbeddedSurfaceFocus(
  editorKey: string,
  nodeKey: NodeKey,
  target: PendingEmbeddedSurfaceFocusTarget,
  request: PendingSurfaceFocusRequest = "current",
): void {
  queuePendingSurfaceFocus(
    getPendingEmbeddedSurfaceFocusId(editorKey, nodeKey, target),
    request,
  );
}
