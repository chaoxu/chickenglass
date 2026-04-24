import { createContext, useContext } from "react";

const TreeViewPortalContext = createContext<HTMLElement | null>(null);

export const TreeViewPortalTargetProvider = TreeViewPortalContext.Provider;

export function useTreeViewPortalTarget(): HTMLElement | null {
  return useContext(TreeViewPortalContext);
}
