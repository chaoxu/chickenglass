import { createContext, useContext } from "react";

import type { FileSystem } from "../lib/types";

const FileSystemContext = createContext<FileSystem | null>(null);

export const FileSystemProvider = FileSystemContext.Provider;

export function useFileSystem(): FileSystem {
  const fs = useContext(FileSystemContext);
  if (!fs) {
    throw new Error("useFileSystem must be used within a FileSystemProvider");
  }
  return fs;
}
