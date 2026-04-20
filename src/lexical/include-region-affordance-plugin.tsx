import { useCallback, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import {
  SurfacePortal,
  useEditorScrollSurface,
  useSurfaceOverlaySync,
  type SurfaceOverlaySync,
  type SurfaceOverlaySyncContext,
} from "../lexical-next";
import type { IncludeRegion } from "../app/source-map";
import { useEditorTelemetryStore } from "../state/editor-telemetry-store";

function findActiveIncludeRegion(
  regions: readonly IncludeRegion[],
  pos: number,
): IncludeRegion | null {
  for (const region of regions) {
    if (pos < region.from || pos >= region.to) {
      continue;
    }
    return findActiveIncludeRegion(region.children, pos) ?? region;
  }
  return null;
}

export function IncludeRegionAffordancePlugin({
  editable,
}: {
  readonly editable: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const surface = useEditorScrollSurface();
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => editor.registerRootListener((nextRootElement) => {
    setRootElement(nextRootElement);
  }), [editor]);

  const clearAffordance = useCallback(() => {
    setPosition(null);
    setPath(null);
  }, []);
  const syncAffordance = useCallback((context: SurfaceOverlaySyncContext) => {
    const sourceMap = window.__cfSourceMap;
    const telemetry = useEditorTelemetryStore.getState();
    const activePos = telemetry.cursorPos > 0
      ? telemetry.cursorPos
      : telemetry.viewportFrom;
    const nextRegion = sourceMap
      ? findActiveIncludeRegion(sourceMap.regions, activePos)
      : null;
    const nextPath = nextRegion?.file ?? null;
    setPath(nextPath);
    if (!nextPath) {
      setPosition(null);
      return;
    }
    setPosition({
      left: context.scrollPosition.left + 24,
      top: context.scrollPosition.top + 12,
    });
  }, []);
  const subscribeAffordanceUpdates = useCallback((sync: SurfaceOverlaySync) =>
    useEditorTelemetryStore.subscribe((state, previous) => {
      if (
        state.cursorPos !== previous.cursorPos
        || state.viewportFrom !== previous.viewportFrom
      ) {
        sync();
      }
    }), []);

  useSurfaceOverlaySync({
    onClear: clearAffordance,
    onSync: syncAffordance,
    rootElement,
    subscribe: subscribeAffordanceUpdates,
    surfaceElement: surface,
  });

  if (!position || !path) {
    return null;
  }

  return (
    <SurfacePortal>
      <div
        className="cf-lexical-include-affordances"
        style={{
          left: `${position.left}px`,
          position: "absolute",
          top: `${position.top}px`,
        }}
      >
        <span
          className={editable ? "cf-lexical-include-path-toggle" : "cf-lexical-include-path-label"}
          title={path}
        >
          {path}
        </span>
      </div>
    </SurfacePortal>
  );
}
