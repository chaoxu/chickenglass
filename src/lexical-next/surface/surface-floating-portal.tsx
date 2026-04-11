import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from "@floating-ui/dom";

import { useEditorScrollSurface } from "./editor-scroll-surface";

export interface SurfaceFloatingPortalProps {
  readonly anchor: HTMLElement;
  readonly children: ReactNode;
  readonly className?: string;
  readonly offsetPx?: number;
  readonly placement?: Placement;
  readonly shiftPaddingPx?: number;
  readonly style?: CSSProperties;
  readonly visible?: boolean;
  readonly zIndex?: number;
}

export function SurfaceFloatingPortal({
  anchor,
  children,
  className,
  offsetPx = 6,
  placement = "bottom-start",
  shiftPaddingPx = 5,
  style,
  visible = true,
  zIndex = 60,
}: SurfaceFloatingPortalProps) {
  const surface = useEditorScrollSurface();
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tooltip = tooltipRef.current;
    if (!surface || !tooltip) {
      return;
    }

    return autoUpdate(anchor, tooltip, () => {
      void computePosition(anchor, tooltip, {
        middleware: [offset(offsetPx), flip(), shift({ padding: shiftPaddingPx })],
        placement,
        strategy: "absolute",
      }).then(({ x, y }) => {
        Object.assign(tooltip.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    });
  }, [anchor, offsetPx, placement, shiftPaddingPx, surface]);

  if (!surface) {
    return null;
  }

  return createPortal(
    <div
      className={className}
      data-visible={visible ? "true" : "false"}
      ref={tooltipRef}
      style={{
        ...style,
        display: visible ? "block" : "none",
        left: 0,
        position: "absolute",
        top: 0,
        zIndex,
      }}
    >
      {children}
    </div>,
    surface,
  );
}
