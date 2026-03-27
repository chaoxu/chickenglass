import { isTauri } from "../lib/tauri";

export interface ConfirmActionOptions {
  kind?: "info" | "warning";
}

export async function confirmAction(
  message: string,
  options?: ConfirmActionOptions,
): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { kind: options?.kind ?? "warning" });
  }

  return window.confirm(message);
}
