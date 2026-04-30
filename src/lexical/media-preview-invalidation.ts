type LocalMediaInvalidationListener = (path: string) => void;

const listeners = new Set<LocalMediaInvalidationListener>();

export function notifyLexicalMediaPreviewInvalidated(path: string): void {
  for (const listener of listeners) {
    listener(path);
  }
}

export function subscribeLexicalMediaPreviewInvalidations(
  listener: LocalMediaInvalidationListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
