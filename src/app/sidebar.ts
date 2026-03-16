import { FileTree } from "./file-tree";
import type { FileSelectHandler, TreeRefreshHandler } from "./file-tree";
import type { FileEntry } from "./file-manager";

/** Callback when a new file is requested from the sidebar. */
export type CreateFileHandler = (path: string) => Promise<void>;

/** Sidebar container wrapping the file tree and action buttons. */
export class Sidebar {
  readonly element: HTMLElement;
  readonly fileTree: FileTree;
  private onCreateFile: CreateFileHandler | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "sidebar";

    const header = document.createElement("div");
    header.className = "sidebar-header";

    const title = document.createElement("span");
    title.className = "sidebar-title";
    title.textContent = "Files";
    header.appendChild(title);

    const newFileBtn = document.createElement("button");
    newFileBtn.className = "sidebar-btn";
    newFileBtn.textContent = "+";
    newFileBtn.title = "New file";
    newFileBtn.addEventListener("click", () => {
      this.promptNewFile();
    });
    header.appendChild(newFileBtn);

    this.element.appendChild(header);

    this.fileTree = new FileTree();
    this.element.appendChild(this.fileTree.element);
  }

  /** Set the handler for file selection in the tree. */
  setSelectHandler(handler: FileSelectHandler): void {
    this.fileTree.setSelectHandler(handler);
  }

  /** Set the handler used to refresh tree data. */
  setRefreshHandler(handler: TreeRefreshHandler): void {
    this.fileTree.setRefreshHandler(handler);
  }

  /** Set the handler for creating new files. */
  setCreateFileHandler(handler: CreateFileHandler): void {
    this.onCreateFile = handler;
  }

  /** Render the file tree from a root entry. */
  render(root: FileEntry): void {
    this.fileTree.render(root);
  }

  /** Set the active file path highlighted in the tree. */
  setActivePath(path: string | null): void {
    this.fileTree.setActivePath(path);
  }

  private promptNewFile(): void {
    const name = prompt("Enter file name (e.g., notes.md):");
    if (name && name.trim()) {
      this.onCreateFile?.(name.trim());
    }
  }
}
