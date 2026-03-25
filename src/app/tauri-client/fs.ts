import type { FileEntry } from "../file-manager";
import { invokeWithPerf } from "../perf";

export function openFolderCommand(path: string, generation: number): Promise<boolean> {
  return invokeWithPerf<boolean>("open_folder", { path, generation });
}

export function revealInFinderCommand(path: string): Promise<void> {
  return invokeWithPerf("reveal_in_finder", { path });
}

export function listTreeCommand(): Promise<FileEntry> {
  return invokeWithPerf<FileEntry>("list_tree");
}

export function readFileCommand(path: string): Promise<string> {
  return invokeWithPerf<string>("read_file", { path });
}

export function writeFileCommand(path: string, content: string): Promise<void> {
  return invokeWithPerf("write_file", { path, content });
}

export function createFileCommand(path: string, content: string): Promise<void> {
  return invokeWithPerf("create_file", { path, content });
}

export function fileExistsCommand(path: string): Promise<boolean> {
  return invokeWithPerf<boolean>("file_exists", { path });
}

export function renameFileCommand(oldPath: string, newPath: string): Promise<void> {
  return invokeWithPerf("rename_file", { oldPath, newPath });
}

export function createDirectoryCommand(path: string): Promise<void> {
  return invokeWithPerf("create_directory", { path });
}

export function deleteFileCommand(path: string): Promise<void> {
  return invokeWithPerf("delete_file", { path });
}

export function writeFileBinaryCommand(path: string, dataBase64: string): Promise<void> {
  return invokeWithPerf("write_file_binary", { path, dataBase64 });
}

export function readFileBinaryCommand(path: string): Promise<string> {
  return invokeWithPerf<string>("read_file_binary", { path });
}

export function toProjectRelativePathCommand(path: string): Promise<string> {
  return invokeWithPerf<string>("to_project_relative_path", { path });
}
