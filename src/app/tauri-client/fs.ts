import type { FileEntry } from "../file-manager";
import { tauriCommand, tauriArgs } from "./make-command";

export const openFolderCommand = tauriArgs<boolean>("open_folder")((path: string, generation: number) => ({ path, generation }));
export const revealInFinderCommand = tauriArgs<undefined>("reveal_in_finder")((path: string) => ({ path }));
export const listTreeCommand = tauriCommand<FileEntry>("list_tree");
export const listChildrenCommand = tauriArgs<FileEntry[]>("list_children")((path: string) => ({ path }));
export const readFileCommand = tauriArgs<string>("read_file")((path: string) => ({ path }));
export const writeFileCommand = tauriArgs<undefined>("write_file")((path: string, content: string) => ({ path, content }));
export const createFileCommand = tauriArgs<undefined>("create_file")((path: string, content: string) => ({ path, content }));
export const fileExistsCommand = tauriArgs<boolean>("file_exists")((path: string) => ({ path }));
export const renameFileCommand = tauriArgs<undefined>("rename_file")((oldPath: string, newPath: string) => ({ oldPath, newPath }));
export const createDirectoryCommand = tauriArgs<undefined>("create_directory")((path: string) => ({ path }));
export const deleteFileCommand = tauriArgs<undefined>("delete_file")((path: string) => ({ path }));
export const writeFileBinaryCommand = tauriArgs<undefined>("write_file_binary")((path: string, dataBase64: string) => ({ path, dataBase64 }));
export const readFileBinaryCommand = tauriArgs<string>("read_file_binary")((path: string) => ({ path }));
export const toProjectRelativePathCommand = tauriArgs<string>("to_project_relative_path")((path: string) => ({ path }));
