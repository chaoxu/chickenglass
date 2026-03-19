import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Platform-aware modifier key label ("Cmd" on macOS, "Ctrl" elsewhere). */
export const isMac =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
export const modKey = isMac ? "Cmd" : "Ctrl";
