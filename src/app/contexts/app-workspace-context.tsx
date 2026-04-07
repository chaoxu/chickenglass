import { createContext, useContext } from "react";
import type { AppWorkspaceSessionController } from "../hooks/use-app-workspace-session";

const AppWorkspaceControllerContext = createContext<AppWorkspaceSessionController | null>(null);

export const AppWorkspaceControllerProvider = AppWorkspaceControllerContext.Provider;

export function useAppWorkspaceController(): AppWorkspaceSessionController {
  const controller = useContext(AppWorkspaceControllerContext);
  if (!controller) {
    throw new Error(
      "useAppWorkspaceController must be used within an AppWorkspaceControllerProvider",
    );
  }
  return controller;
}
