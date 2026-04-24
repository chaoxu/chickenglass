import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs, tauriCommand } from "./make-command";
import { projectFilePath } from "../../lib/project-file-paths";

export type { OpenFolderResult } from "./command-contract";

const fsCommands = TAURI_COMMAND_CONTRACT.fs;

export const openFolderCommand = tauriArgs(fsCommands.openFolder)(
  (path: string, generation: number) => ({ path, generation }),
);
export const listTreeCommand = tauriCommand(fsCommands.listTree);
export const listChildrenCommand = tauriArgs(fsCommands.listChildren)(
  (path: string) => ({ path: projectFilePath(path) }),
);
export const readFileCommand = tauriArgs(fsCommands.readFile)(
  (path: string) => ({ path: projectFilePath(path) }),
);
export const writeFileCommand = tauriArgs(fsCommands.writeFile)(
  (path: string, content: string) => ({ path: projectFilePath(path), content }),
);
export const writeFileIfUnchangedCommand = tauriArgs(fsCommands.writeFileIfHash)(
  (path: string, content: string, expectedHash: string) => ({
    path: projectFilePath(path),
    content,
    expectedHash,
  }),
);
export const createFileCommand = tauriArgs(fsCommands.createFile)(
  (path: string, content: string) => ({ path: projectFilePath(path), content }),
);
export const fileExistsCommand = tauriArgs(fsCommands.fileExists)(
  (path: string) => ({ path: projectFilePath(path) }),
);
export const renameFileCommand = tauriArgs(fsCommands.renameFile)(
  (oldPath: string, newPath: string) => ({
    oldPath: projectFilePath(oldPath),
    newPath: projectFilePath(newPath),
  }),
);
export const createDirectoryCommand = tauriArgs(fsCommands.createDirectory)(
  (path: string) => ({ path: projectFilePath(path) }),
);
export const deleteFileCommand = tauriArgs(fsCommands.deleteFile)(
  (path: string) => ({ path: projectFilePath(path) }),
);
export const writeFileBinaryCommand = tauriArgs(fsCommands.writeFileBinary)(
  (path: string, dataBase64: string) => ({ path: projectFilePath(path), dataBase64 }),
);
export const readFileBinaryCommand = tauriArgs(fsCommands.readFileBinary)(
  (path: string) => ({ path: projectFilePath(path) }),
);

export { toProjectRelativePathCommand } from "./path";
export { revealInFinderCommand } from "./shell";
