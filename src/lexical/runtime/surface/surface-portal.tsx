import { createPortal } from "react-dom";
import type { ReactNode } from "react";

import { useEditorScrollSurface } from "./editor-scroll-surface";

export function SurfacePortal({
  children,
}: {
  readonly children: ReactNode;
}) {
  const surface = useEditorScrollSurface();

  if (!surface) {
    return null;
  }

  return createPortal(children, surface);
}
