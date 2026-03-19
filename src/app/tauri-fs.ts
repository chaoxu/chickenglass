/**
 * Tauri-backed filesystem implementation.
 *
 * Uses Tauri's invoke() to call Rust commands for all file operations.
 * Requires a project folder to be opened first via openFolder().
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { FileEntry, FileSystem } from "./file-manager";
import { uint8ArrayToBase64 } from "./lib/utils";

/** Check whether we're running inside a Tauri webview. */
export function isTauri(): boolean {
  return "__TAURI__" in window;
}

/**
 * Open a native folder picker dialog and set it as the project root.
 * Returns the selected path, or null if the user cancelled.
 */
export async function openFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  if (!selected) return null;
  const path = selected as string;
  await invoke("open_folder", { path });
  return path;
}

/**
 * Reveal a file in the OS file explorer (Finder on macOS, Explorer on Windows).
 * Only available in Tauri mode. Silently no-ops in browser mode.
 *
 * @param path - Absolute path of the file to reveal.
 */
export async function revealInFinder(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("reveal_in_finder", { path });
}

/** FileSystem implementation backed by Tauri Rust commands. */
export class TauriFileSystem implements FileSystem {
  async listTree(): Promise<FileEntry> {
    return invoke<FileEntry>("list_tree");
  }

  async readFile(path: string): Promise<string> {
    return invoke<string>("read_file", { path });
  }

  async writeFile(path: string, content: string): Promise<void> {
    await invoke("write_file", { path, content });
  }

  async createFile(path: string, content?: string): Promise<void> {
    await invoke("create_file", { path, content: content ?? "" });
  }

  async exists(path: string): Promise<boolean> {
    return invoke<boolean>("file_exists", { path });
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await invoke("rename_file", { oldPath, newPath });
  }

  async createDirectory(path: string): Promise<void> {
    await invoke("create_directory", { path });
  }

  async deleteFile(path: string): Promise<void> {
    await invoke("delete_file", { path });
  }

  async writeFileBinary(path: string, data: Uint8Array): Promise<void> {
    const dataBase64 = uint8ArrayToBase64(data);
    await invoke("write_file_binary", { path, dataBase64 });
  }
}
