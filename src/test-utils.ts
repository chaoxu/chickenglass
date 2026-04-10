/**
 * Install a spec-compliant in-memory localStorage shim on `globalThis`.
 *
 * Returns a handle with a `clear()` method that empties the backing store.
 * Node 25+ exposes a native `localStorage` that lacks standard methods when
 * `--localstorage-file` is not set. This shim replaces it unconditionally.
 */
export function installLocalStorageMock(): { clear: () => void } {
  const storage = new Map<string, string>();
  const shim: Storage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
  return { clear: () => storage.clear() };
}
