import type { FileEntry } from "./file-manager";

/** Callback when a file is selected in the tree. */
export type FileSelectHandler = (path: string) => void;

/** Callback to refresh the tree (e.g., after creating a file). */
export type TreeRefreshHandler = () => Promise<FileEntry>;

/** File tree sidebar component. */
export class FileTree {
  readonly element: HTMLElement;
  private onSelect: FileSelectHandler | null = null;
  private onRefresh: TreeRefreshHandler | null = null;
  private activePath: string | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "file-tree";
  }

  /** Set the handler called when a file is clicked. */
  setSelectHandler(handler: FileSelectHandler): void {
    this.onSelect = handler;
  }

  /** Set the handler used to refresh the tree data. */
  setRefreshHandler(handler: TreeRefreshHandler): void {
    this.onRefresh = handler;
  }

  /** Set the currently active file path (highlighted in tree). */
  setActivePath(path: string | null): void {
    this.activePath = path;
    this.updateActiveHighlight();
  }

  /** Render the file tree from a root FileEntry. */
  render(root: FileEntry): void {
    this.element.innerHTML = "";
    if (root.children) {
      for (const child of root.children) {
        this.element.appendChild(this.renderEntry(child, 0));
      }
    }
  }

  /** Refresh the tree by calling the refresh handler. */
  async refresh(): Promise<void> {
    if (this.onRefresh) {
      const root = await this.onRefresh();
      this.render(root);
    }
  }

  private renderEntry(entry: FileEntry, depth: number): HTMLElement {
    const item = document.createElement("div");
    item.className = "file-tree-item";
    item.dataset.path = entry.path;
    item.style.paddingLeft = `${depth * 16 + 8}px`;

    const icon = document.createElement("span");
    icon.className = "file-tree-icon";
    icon.textContent = entry.isDirectory ? "\u25B6" : "\u25CB";
    item.appendChild(icon);

    const label = document.createElement("span");
    label.className = "file-tree-label";
    label.textContent = entry.name;
    item.appendChild(label);

    if (entry.isDirectory) {
      item.classList.add("file-tree-directory");

      const childContainer = document.createElement("div");
      childContainer.className = "file-tree-children";
      childContainer.style.display = "none";

      if (entry.children) {
        for (const child of entry.children) {
          childContainer.appendChild(this.renderEntry(child, depth + 1));
        }
      }

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = childContainer.style.display !== "none";
        childContainer.style.display = isOpen ? "none" : "block";
        icon.textContent = isOpen ? "\u25B6" : "\u25BC";
      });

      const wrapper = document.createElement("div");
      wrapper.appendChild(item);
      wrapper.appendChild(childContainer);
      return wrapper;
    }

    if (entry.path === this.activePath) {
      item.classList.add("file-tree-active");
    }

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onSelect?.(entry.path);
    });

    return item;
  }

  private updateActiveHighlight(): void {
    const items = this.element.querySelectorAll(".file-tree-item");
    for (const item of items) {
      const el = item as HTMLElement;
      if (el.dataset.path === this.activePath) {
        el.classList.add("file-tree-active");
      } else {
        el.classList.remove("file-tree-active");
      }
    }
  }
}
