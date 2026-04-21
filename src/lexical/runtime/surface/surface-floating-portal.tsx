import { useEffect, useRef, type CSSProperties, type PointerEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, computePosition, flip, hide, offset, shift, type Placement } from "@floating-ui/dom";

import { useEditorScrollSurface } from "./editor-scroll-surface";

export interface SurfaceFloatingPortalProps {
  readonly anchor: HTMLElement;
  readonly children: ReactNode;
  readonly className?: string;
  readonly offsetPx?: number;
  readonly onAnchorLost?: () => void;
  readonly onPointerEnter?: PointerEventHandler<HTMLDivElement>;
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
  onAnchorLost,
  onPointerEnter,
  placement = "bottom-start",
  shiftPaddingPx = 5,
  style,
  visible = true,
  zIndex = 60,
}: SurfaceFloatingPortalProps) {
  const surface = useEditorScrollSurface();
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const onAnchorLostRef = useRef(onAnchorLost);

  useEffect(() => {
    onAnchorLostRef.current = onAnchorLost;
  }, [onAnchorLost]);

  useEffect(() => {
    const tooltip = tooltipRef.current;
    if (!surface || !tooltip) {
      return;
    }

    return autoUpdate(anchor, tooltip, () => {
      void computePosition(anchor, tooltip, {
        middleware: [offset(offsetPx), flip(), shift({ padding: shiftPaddingPx }), hide()],
        placement,
        strategy: "absolute",
      }).then(({ middlewareData, x, y }) => {
        Object.assign(tooltip.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
        if (middlewareData.hide?.referenceHidden) {
          onAnchorLostRef.current?.();
        }
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
      onPointerEnter={onPointerEnter}
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
