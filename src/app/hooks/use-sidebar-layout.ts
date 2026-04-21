import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export type SidebarTab = "files" | "outline" | "diagnostics" | "runtime";

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

export function useSidebarLayout(): SidebarLayoutController {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 640px)").matches
      : false
  );
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [sidenotesCollapsed, setSidenotesCollapsed] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
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
