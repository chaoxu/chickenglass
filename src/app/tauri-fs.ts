/**
 * Tauri-backed filesystem implementation.
 *
 * Uses the typed Tauri client layer to call Rust commands for file operations.
 * Requires a project folder to be opened first via openFolder().
 */

import { open } from "@tauri-apps/plugin-dialog";
import type { FileEntry, FileSystem } from "./file-manager";
import { base64ToUint8Array, uint8ArrayToBase64 } from "./lib/utils";
import {
  createDirectoryCommand,
  createFileCommand,
  deleteFileCommand,
  fileExistsCommand,
  listTreeCommand,
  openFolderCommand,
  readFileBinaryCommand,
  readFileCommand,
  renameFileCommand,
  revealInFinderCommand,
  writeFileBinaryCommand,
  writeFileCommand,
} from "./tauri-client/fs";

// Import for internal use and re-export so existing app/ imports continue to work.
import { isTauri } from "../lib/tauri";
export { isTauri } from "../lib/tauri";

let latestProjectRootGeneration = 0;

/**
 * Open a native folder picker dialog.
 * Returns the selected path, or null if the user cancelled.
 */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  // open() returns null on cancel, or a string (single) or string[] (multiple).
  // We pass multiple: false so an array result should not occur, but guard anyway.
  return !selected || Array.isArray(selected) ? null : selected;
}

/**
 * Set the current Tauri project root to an already-known absolute folder path.
 * Returns true when this request won the backend generation race.
 */
export async function openFolderAt(path: string, generation: number): Promise<boolean> {
  latestProjectRootGeneration = Math.max(latestProjectRootGeneration, generation);
  return openFolderCommand(path, generation);
}

/**
 * Open a native folder picker dialog and set it as the project root.
 * Returns the selected path, or null if the user cancelled.
 */
export async function openFolder(): Promise<string | null> {
  const selected = await pickFolder();
  if (!selected) return null;
  await openFolderAt(selected, latestProjectRootGeneration + 1);
  return selected;
}

/**
 * Reveal a file in the OS file explorer (Finder on macOS, Explorer on Windows).
 * Only available in Tauri mode. Silently no-ops in browser mode.
 *
 * @param path - Absolute path of the file to reveal.
 */
export async function revealInFinder(path: string): Promise<void> {
  if (!isTauri()) return;
  await revealInFinderCommand(path);
}

/** FileSystem implementation backed by Tauri Rust commands. */
export class TauriFileSystem implements FileSystem {
  async listTree(): Promise<FileEntry> {
    return listTreeCommand();
  }

  async readFile(path: string): Promise<string> {
    return readFileCommand(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFileCommand(path, content);
  }

  async createFile(path: string, content?: string): Promise<void> {
    await createFileCommand(path, content ?? "");
  }

  async exists(path: string): Promise<boolean> {
    return fileExistsCommand(path);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await renameFileCommand(oldPath, newPath);
  }

  async createDirectory(path: string): Promise<void> {
    await createDirectoryCommand(path);
  }

  async deleteFile(path: string): Promise<void> {
    await deleteFileCommand(path);
  }

  async writeFileBinary(path: string, data: Uint8Array): Promise<void> {
    const dataBase64 = uint8ArrayToBase64(data);
    await writeFileBinaryCommand(path, dataBase64);
  }

  async readFileBinary(path: string): Promise<Uint8Array> {
    const dataBase64 = await readFileBinaryCommand(path);
    return base64ToUint8Array(dataBase64);
  }
}
