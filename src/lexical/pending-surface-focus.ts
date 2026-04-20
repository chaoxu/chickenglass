import type { NodeKey } from "lexical";

import type { FocusRequestEdge } from "./editor-focus-plugin";

export type PendingSurfaceFocusRequest =
  | FocusRequestEdge
  | { readonly offset: number };

export type PendingEmbeddedSurfaceFocusTarget =
  | "block-body"
  | "block-caption"
  | "block-title"
  | "footnote-body"
  | "structure-source";

const pendingSurfaceFocus = new Map<string, PendingSurfaceFocusRequest>();
const pendingSurfaceFocusListeners = new Map<
  string,
  Set<(request: PendingSurfaceFocusRequest) => void>
>();

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
  const listeners = pendingSurfaceFocusListeners.get(focusId);
  if (listeners && listeners.size > 0) {
    pendingSurfaceFocus.delete(focusId);
    for (const listener of listeners) {
      listener(request);
    }
    return;
  }
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

export function subscribePendingSurfaceFocus(
  focusId: string,
  listener: (request: PendingSurfaceFocusRequest) => void,
): () => void {
  const listeners = pendingSurfaceFocusListeners.get(focusId) ?? new Set();
  listeners.add(listener);
  pendingSurfaceFocusListeners.set(focusId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      pendingSurfaceFocusListeners.delete(focusId);
    }
  };
}
