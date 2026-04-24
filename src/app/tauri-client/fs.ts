import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriCommand, tauriArgs } from "./make-command";

const fsCommands = TAURI_COMMAND_CONTRACT.fs;

export const openFolderCommand = tauriArgs(fsCommands.openFolder)(
  (path: string, generation: number) => ({ path, generation }),
);
export const listTreeCommand = tauriCommand(fsCommands.listTree);
export const listChildrenCommand = tauriArgs(fsCommands.listChildren)(
  (path: string) => ({ path }),
);
export const readFileCommand = tauriArgs(fsCommands.readFile)((path: string) => ({ path }));
export const writeFileCommand = tauriArgs(fsCommands.writeFile)(
  (path: string, content: string) => ({ path, content }),
);
export const writeFileIfUnchangedCommand = tauriArgs(fsCommands.writeFileIfHash)(
  (path: string, content: string, expectedHash: string) => ({
    path,
    content,
    expectedHash,
  }),
);
export const createFileCommand = tauriArgs(fsCommands.createFile)(
  (path: string, content: string) => ({ path, content }),
);
export const fileExistsCommand = tauriArgs(fsCommands.fileExists)((path: string) => ({ path }));
export const renameFileCommand = tauriArgs(fsCommands.renameFile)(
  (oldPath: string, newPath: string) => ({ oldPath, newPath }),
);
export const createDirectoryCommand = tauriArgs(fsCommands.createDirectory)(
  (path: string) => ({ path }),
);
export const deleteFileCommand = tauriArgs(fsCommands.deleteFile)((path: string) => ({ path }));
export const writeFileBinaryCommand = tauriArgs(fsCommands.writeFileBinary)(
  (path: string, dataBase64: string) => ({ path, dataBase64 }),
);
export const readFileBinaryCommand = tauriArgs(fsCommands.readFileBinary)(
  (path: string) => ({ path }),
);

export { toProjectRelativePathCommand } from "./path";
export { revealInFinderCommand } from "./shell";
