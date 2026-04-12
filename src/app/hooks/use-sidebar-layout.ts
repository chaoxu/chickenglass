import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [sidenotesCollapsed, setSidenotesCollapsed] = useState(true);

  return useMemo(() => ({
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    sidebarTab,
    setSidebarTab,
    sidenotesCollapsed,
    setSidenotesCollapsed,
  }), [sidebarCollapsed, sidebarWidth, sidebarTab, sidenotesCollapsed]);
}
