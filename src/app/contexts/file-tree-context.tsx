import { createContext, useContext } from "react";
import type { GitStatusMap } from "../tauri-client/git";

export interface FileTreeContextValue {
  activePath: string | null;
  gitStatus: GitStatusMap;
  onSelect: (path: string) => void;
  onDoubleClick?: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
}

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export const FileTreeProvider = FileTreeContext.Provider;

/** Returns the FileTreeContext. Throws if used outside a FileTreeProvider. */
export function useFileTreeContext(): FileTreeContextValue {
  const ctx = useContext(FileTreeContext);
  if (!ctx) {
    throw new Error("useFileTreeContext must be used within a FileTreeProvider");
  }
  return ctx;
}
