import { createContext, useContext } from "react";
import type { AppPreferencesController } from "../hooks/use-app-preferences";

const AppPreferencesControllerContext = createContext<AppPreferencesController | null>(null);

export const AppPreferencesControllerProvider = AppPreferencesControllerContext.Provider;

export function useAppPreferencesController(): AppPreferencesController {
  const controller = useContext(AppPreferencesControllerContext);
  if (!controller) {
    throw new Error(
      "useAppPreferencesController must be used within an AppPreferencesControllerProvider",
    );
  }
  return controller;
}
