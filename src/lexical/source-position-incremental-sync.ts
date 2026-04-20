const pendingIncrementalSyncs = new WeakMap<HTMLElement, number>();

export function markIncrementalSourcePositionSync(root: HTMLElement): void {
  pendingIncrementalSyncs.set(root, (pendingIncrementalSyncs.get(root) ?? 0) + 1);
}

export function consumeIncrementalSourcePositionSync(root: HTMLElement): boolean {
  const pending = pendingIncrementalSyncs.get(root) ?? 0;
  if (pending <= 0) {
    return false;
  }
  if (pending === 1) {
    pendingIncrementalSyncs.delete(root);
  } else {
    pendingIncrementalSyncs.set(root, pending - 1);
  }
  return true;
}
