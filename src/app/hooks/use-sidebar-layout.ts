import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { SidebarTab } from "../../lib/debug-types";

export type { SidebarTab } from "../../lib/debug-types";

export interface SidebarLayoutController {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  sidebarTab: SidebarTab;
  setSidebarTab: Dispatch<SetStateAction<SidebarTab>>;
  sidenotesCollapsed: boolean;
  setSidenotesCollapsed: Dispatch<SetStateAction<boolean>>;
}

const NARROW_VIEWPORT_QUERY = "(max-width: 640px)";

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}

export function useSidebarLayout(): SidebarLayoutController {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isNarrowViewport);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [sidenotesCollapsed, setSidenotesCollapsed] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const collapseForNarrowViewport = () => {
      if (media.matches) {
        setSidebarCollapsed(true);
      }
    };

    collapseForNarrowViewport();
    media.addEventListener("change", collapseForNarrowViewport);
    return () => {
      media.removeEventListener("change", collapseForNarrowViewport);
    };
  }, []);

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    sidebarTab,
    setSidebarTab,
    sidenotesCollapsed,
    setSidenotesCollapsed,
  };
}
