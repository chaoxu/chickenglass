import { useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "lexical";

import { SurfacePortal, useEditorScrollSurface } from "../lexical-next";
import type { IncludeRegion } from "../app/source-map";
import { useEditorTelemetryStore } from "../app/stores/editor-telemetry-store";

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

  useEffect(() => {
    if (!rootElement || !surface) {
      setPosition(null);
      setPath(null);
      return undefined;
    }

    const sync = () => {
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
        left: surface.scrollLeft + 24,
        top: surface.scrollTop + 12,
      });
    };

    sync();
    surface.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);

    return mergeRegister(
      editor.registerUpdateListener(() => {
        sync();
      }),
      useEditorTelemetryStore.subscribe((state, previous) => {
        if (
          state.cursorPos !== previous.cursorPos
          || state.viewportFrom !== previous.viewportFrom
        ) {
          sync();
        }
      }),
      () => {
        surface.removeEventListener("scroll", sync);
        window.removeEventListener("resize", sync);
      },
    );
  }, [editor, rootElement, surface]);

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
