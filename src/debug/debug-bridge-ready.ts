export type DebugBridgeReadySlice = "app" | "editor" | "cfDebug";

const readyResolvers = new Map<DebugBridgeReadySlice, () => void>();

const readyPromises: Record<DebugBridgeReadySlice, Promise<void>> = {
  app: new Promise<void>((resolve) => {
    readyResolvers.set("app", resolve);
  }),
  editor: new Promise<void>((resolve) => {
    readyResolvers.set("editor", resolve);
  }),
  cfDebug: new Promise<void>((resolve) => {
    readyResolvers.set("cfDebug", resolve);
  }),
};

export function getDebugBridgeReadyPromise(
  slice: DebugBridgeReadySlice,
): Promise<void> {
  return readyPromises[slice];
}

export function markDebugBridgeReady(slice: DebugBridgeReadySlice): void {
  const resolve = readyResolvers.get(slice);
  if (!resolve) return;
  readyResolvers.delete(slice);
  resolve();
}
