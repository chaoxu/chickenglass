/**
 * Save-before-close confirmation dialog.
 *
 * In Tauri mode, uses the native dialog plugin with Save / Don't Save / Cancel.
 * In browser mode, falls back to window.confirm().
 */

import { message as tauriMessage } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./tauri-fs";

/** Result of the save confirmation dialog. */
export type SaveDialogResult = "save" | "discard" | "cancel";

/**
 * Show a save confirmation dialog for a single file.
 * Returns the user's choice: save, discard, or cancel.
 */
export async function showSaveDialog(fileName: string): Promise<SaveDialogResult> {
  return showDialog(
    `Do you want to save changes to "${fileName}"?`,
    "Save",
  );
}

/**
 * Show a save-all confirmation dialog when closing the window with dirty tabs.
 * Returns the user's choice: save (all), discard (all), or cancel.
 */
export async function showSaveAllDialog(dirtyCount: number): Promise<SaveDialogResult> {
  const fileWord = dirtyCount === 1 ? "file has" : "files have";
  return showDialog(
    `${dirtyCount} ${fileWord} unsaved changes. Save before closing?`,
    "Save All",
  );
}

/** Shared implementation: Tauri native dialog or browser confirm. */
async function showDialog(
  text: string,
  saveLabel: string,
): Promise<SaveDialogResult> {
  if (isTauri()) {
    return showTauriDialog(text, saveLabel);
  }
  return showBrowserDialog(text);
}

async function showTauriDialog(
  text: string,
  saveLabel: string,
): Promise<SaveDialogResult> {
  const result = await tauriMessage(text, {
    title: "Unsaved Changes",
    kind: "warning",
    buttons: {
      yes: saveLabel,
      no: "Don\u2019t Save",
      cancel: "Cancel",
    },
  });
  if (result === "Yes") return "save";
  if (result === "No") return "discard";
  return "cancel";
}

function showBrowserDialog(text: string): SaveDialogResult {
  // Browser confirm only has OK/Cancel, no three-way choice.
  const confirmed = window.confirm(text);
  return confirmed ? "save" : "cancel";
}
