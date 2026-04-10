import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "lexical";

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
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => editor.registerRootListener((nextRootElement) => {
    setRootElement(nextRootElement);
  }), [editor]);

  useEffect(() => {
    if (!rootElement) {
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
      const rect = rootElement.getBoundingClientRect();
      setPosition({
        left: rect.left + 24,
        top: rect.top + 12,
      });
    };

    sync();
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
        window.removeEventListener("resize", sync);
      },
    );
  }, [editor, rootElement]);

  const portal = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);

  if (!portal || !position || !path) {
    return null;
  }

  return createPortal(
    <div
      className="cf-lexical-include-affordances"
      style={{
        left: `${position.left}px`,
        position: "fixed",
        top: `${position.top}px`,
      }}
    >
      <span
        className={editable ? "cf-lexical-include-path-toggle" : "cf-lexical-include-path-label"}
        title={path}
      >
        {path}
      </span>
    </div>,
    portal,
  );
}
