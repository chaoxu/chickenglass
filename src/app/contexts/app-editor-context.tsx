import { createContext, useContext } from "react";
import type { AppEditorShellController } from "../hooks/use-app-editor-shell";

const AppEditorControllerContext = createContext<AppEditorShellController | null>(null);

export const AppEditorControllerProvider = AppEditorControllerContext.Provider;

export function useAppEditorController(): AppEditorShellController {
  const controller = useContext(AppEditorControllerContext);
  if (!controller) {
    throw new Error(
      "useAppEditorController must be used within an AppEditorControllerProvider",
    );
  }
  return controller;
}
