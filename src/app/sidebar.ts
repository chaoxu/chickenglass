import { FileTree } from "./file-tree";
import type { FileSelectHandler, TreeRefreshHandler } from "./file-tree";
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

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "sidebar";

    // Files section (collapsible)
    const filesSection = this.createCollapsibleSection("Files");
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

  /** Render the file tree from a root entry. */
  render(root: FileEntry): void {
    this.fileTree.render(root);
  }

  /** Set the active file path highlighted in the tree. */
  setActivePath(path: string | null): void {
    this.fileTree.setActivePath(path);
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
