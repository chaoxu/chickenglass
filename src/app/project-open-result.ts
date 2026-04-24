import type { FileEntry } from "./file-manager";

export interface ProjectOpenResult {
  projectRoot: string;
  tree: FileEntry;
}
