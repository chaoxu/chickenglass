import type { FileEntry } from "../file-manager";
import { TAURI_COMMANDS } from "./bridge-metadata";
import { tauriCommand, tauriArgs } from "./make-command";

export const openFolderCommand = tauriArgs<boolean>(TAURI_COMMANDS.openFolder)((path: string, generation: number) => ({ path, generation }));
export const revealInFinderCommand = tauriArgs<undefined>(TAURI_COMMANDS.revealInFinder)((path: string) => ({ path }));
export const listTreeCommand = tauriCommand<FileEntry>(TAURI_COMMANDS.listTree);
export const listChildrenCommand = tauriArgs<FileEntry[]>(TAURI_COMMANDS.listChildren)((path: string) => ({ path }));
export const readFileCommand = tauriArgs<string>(TAURI_COMMANDS.readFile)((path: string) => ({ path }));
export const writeFileCommand = tauriArgs<undefined>(TAURI_COMMANDS.writeFile)((path: string, content: string) => ({ path, content }));
export const createFileCommand = tauriArgs<undefined>(TAURI_COMMANDS.createFile)((path: string, content: string) => ({ path, content }));
export const fileExistsCommand = tauriArgs<boolean>(TAURI_COMMANDS.fileExists)((path: string) => ({ path }));
export const renameFileCommand = tauriArgs<undefined>(TAURI_COMMANDS.renameFile)((oldPath: string, newPath: string) => ({ oldPath, newPath }));
export const createDirectoryCommand = tauriArgs<undefined>(TAURI_COMMANDS.createDirectory)((path: string) => ({ path }));
export const deleteFileCommand = tauriArgs<undefined>(TAURI_COMMANDS.deleteFile)((path: string) => ({ path }));
export const writeFileBinaryCommand = tauriArgs<undefined>(TAURI_COMMANDS.writeFileBinary)((path: string, dataBase64: string) => ({ path, dataBase64 }));
export const readFileBinaryCommand = tauriArgs<string>(TAURI_COMMANDS.readFileBinary)((path: string) => ({ path }));
export const toProjectRelativePathCommand = tauriArgs<string>(TAURI_COMMANDS.toProjectRelativePath)((path: string) => ({ path }));
