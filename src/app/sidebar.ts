import { FileTree } from "./file-tree";
import type {
  FileSelectHandler,
  TreeRefreshHandler,
  FileRenameHandler,
  CreateDirectoryHandler,
} from "./file-tree";
import type { FileEntry } from "./file-manager";
import { Outline } from "./outline";

/** Callback when a new file is requested from the sidebar. */
export type CreateFileHandler = (path: string) => Promise<void>;

/** Sidebar container wrapping the file tree, outline, and action buttons. */
export class Sidebar {
  readonly element: HTMLElement;
  readonly fileTree: FileTree;
  readonly outline: Outline;
  private onCreateFile: CreateFileHandler | null = null;
  private collapsed = false;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "sidebar";

    // Restore persisted collapse state
    try {
      this.collapsed = localStorage.getItem("cg-sidebar-collapsed") === "true";
    } catch {
      // localStorage unavailable
    }
    if (this.collapsed) {
      this.element.classList.add("sidebar-collapsed");
    }

    // Files section (collapsible)
    const filesSection = this.createCollapsibleSection("Files");

    const newFolderBtn = document.createElement("button");
    newFolderBtn.className = "sidebar-btn";
    newFolderBtn.textContent = "\uD83D\uDCC1"; // folder emoji
    newFolderBtn.title = "New folder";
    newFolderBtn.addEventListener("click", () => {
      this.fileTree.startNewFolderAtRoot();
    });
    filesSection.header.appendChild(newFolderBtn);

    const newFileBtn = document.createElement("button");
    newFileBtn.className = "sidebar-btn";
    newFileBtn.textContent = "+";
    newFileBtn.title = "New file";
    newFileBtn.addEventListener("click", () => {
      this.promptNewFile();
    });
    filesSection.header.appendChild(newFileBtn);

    this.fileTree = new FileTree();
    filesSection.body.appendChild(this.fileTree.element);
    this.element.appendChild(filesSection.container);

    // Outline section (collapsible)
    const outlineSection = this.createCollapsibleSection("Outline");
    this.outline = new Outline();
    outlineSection.body.appendChild(this.outline.element);
    this.element.appendChild(outlineSection.container);
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

  /** Set the handler for renaming files. */
  setRenameHandler(handler: FileRenameHandler): void {
    this.fileTree.setRenameHandler(handler);
  }

  /** Set the handler for creating new directories. */
  setCreateDirectoryHandler(handler: CreateDirectoryHandler): void {
    this.fileTree.setCreateDirectoryHandler(handler);
  }

  /** Render the file tree from a root entry. */
  render(root: FileEntry): void {
    this.fileTree.render(root);
  }

  /** Set the active file path highlighted in the tree. */
  setActivePath(path: string | null): void {
    this.fileTree.setActivePath(path);
  }

  /** Toggle sidebar visibility. */
  toggle(): void {
    this.collapsed = !this.collapsed;
    this.element.classList.toggle("sidebar-collapsed", this.collapsed);
    try {
      localStorage.setItem("cg-sidebar-collapsed", String(this.collapsed));
    } catch {
      // localStorage unavailable
    }
  }

  /** Whether the sidebar is currently collapsed. */
  isCollapsed(): boolean {
    return this.collapsed;
  }

  private createCollapsibleSection(title: string): {
    container: HTMLElement;
    header: HTMLElement;
    body: HTMLElement;
  } {
    const container = document.createElement("div");
    container.className = "sidebar-section";

    const header = document.createElement("div");
    header.className = "sidebar-header sidebar-header-collapsible";

    const toggle = document.createElement("span");
    toggle.className = "sidebar-toggle";
    toggle.textContent = "▼";

    const label = document.createElement("span");
    label.className = "sidebar-title";
    label.textContent = title;

    header.prepend(toggle);
    header.appendChild(label);

    const body = document.createElement("div");
    body.className = "sidebar-section-body";

    header.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".sidebar-btn")) return;
      const collapsed = body.style.display === "none";
      body.style.display = collapsed ? "" : "none";
      toggle.textContent = collapsed ? "▼" : "▶";
    });

    container.appendChild(header);
    container.appendChild(body);

    return { container, header, body };
  }

  private promptNewFile(): void {
    const name = prompt("Enter file name (e.g., notes.md):");
    if (name && name.trim()) {
      this.onCreateFile?.(name.trim());
    }
  }
}
