export interface ActiveDocumentSnapshot {
  path: string | null;
  revision: number;
}

export interface ActiveDocumentSignal {
  getSnapshot: () => ActiveDocumentSnapshot;
  subscribe: (listener: () => void) => () => void;
  publish: (path: string | null) => void;
}

export const EMPTY_ACTIVE_DOCUMENT_SNAPSHOT: ActiveDocumentSnapshot = {
  path: null,
  revision: 0,
};
export const unsubscribeNoop = () => {};

export function createActiveDocumentSignal(): ActiveDocumentSignal {
  let snapshot = EMPTY_ACTIVE_DOCUMENT_SNAPSHOT;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (path) => {
      snapshot = {
        path,
        revision: snapshot.revision + 1,
      };
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
