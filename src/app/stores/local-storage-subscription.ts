type Listener = () => void;

const listenersByKey = new Map<string, Set<Listener>>();
let storageListenerAttached = false;

function notifyKey(key: string): void {
  for (const listener of listenersByKey.get(key) ?? []) {
    listener();
  }
}

function attachStorageListener(): void {
  if (storageListenerAttached || typeof window === "undefined") {
    return;
  }
  storageListenerAttached = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null) {
      for (const key of listenersByKey.keys()) {
        notifyKey(key);
      }
      return;
    }
    notifyKey(event.key);
  });
}

export function subscribeLocalStorageKey(key: string, listener: Listener): () => void {
  attachStorageListener();
  const listeners = listenersByKey.get(key) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByKey.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByKey.delete(key);
    }
  };
}

export function emitLocalStorageKeyChange(key: string): void {
  notifyKey(key);
}
