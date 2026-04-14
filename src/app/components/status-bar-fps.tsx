import { memo, useSyncExternalStore } from "react";

import { subscribeFpsMeter, getFpsMeterSnapshot } from "../fps-meter";

export const FpsIndicator = memo(function FpsIndicator() {
  const { enabled, fps, frameTime } = useSyncExternalStore(subscribeFpsMeter, getFpsMeterSnapshot);
  if (!enabled) return null;

  return (
    <span className="tabular-nums text-[var(--cf-muted)]" title={`${frameTime} ms/frame`}>
      {fps} FPS
    </span>
  );
});
