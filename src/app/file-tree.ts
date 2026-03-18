import type { FileEntry } from "./file-manager";

/** Callback when a file is selected in the tree. */
export type FileSelectHandler = (path: string) => void;

/** Callback when a file is deleted. Returns null if cancelled. */
export type FileDeleteHandler = (path: string) => Promise<string | null>;

/** Callback to refresh the tree (e.g., after creating a file). */
export type TreeRefreshHandler = () => Promise<FileEntry>;

/**
 * Callback when a file is renamed.
 * Returns an error message string on failure, or null on success.
 */
export type FileRenameHandler = (
  oldPath: string,
  newPath: string,
) => Promise<string | null>;

/**
 * Callback when a new directory is created.
 * Returns an error message string on failure, or null on success.
 */
export type CreateDirectoryHandler = (path: string) => Promise<string | null>;

/** File tree sidebar component. */
export class FileTree {
  readonly element: HTMLElement;
  private onSelect: FileSelectHandler | null = null;
  private onRefresh: TreeRefreshHandler | null = null;
  private onRename: FileRenameHandler | null = null;
  private onCreateDirectory: CreateDirectoryHandler | null = null;
  private activePath: string | null = null;
  /** The file-tree-item element currently focused for keyboard interaction. */
  private focusedItem: HTMLElement | null = null;
  /** Context menu element currently shown (if any). */
  private activeContextMenu: HTMLElement | null = null;
  /** Bound listener stored so it can be removed in destroy(). */
  private readonly globalClickListener: () => void;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "file-tree";
    this.element.setAttribute("tabindex", "0");

    // Dismiss the context menu on any click outside it
    this.globalClickListener = () => this.dismissContextMenu();
    document.addEventListener("click", this.globalClickListener);
  }

  /** Remove global event listeners. Call when the tree is removed from the DOM. */
  destroy(): void {
    document.removeEventListener("click", this.globalClickListener);
    this.dismissContextMenu();
  }

  /** Set the handler called when a file is clicked. */
  setSelectHandler(handler: FileSelectHandler): void {
    this.onSelect = handler;
  }

  /** Set the handler used to refresh the tree data. */
  setRefreshHandler(handler: TreeRefreshHandler): void {
    this.onRefresh = handler;
  }

  /** Set the handler called when a file is renamed. */
  setRenameHandler(handler: FileRenameHandler): void {
    this.onRename = handler;
  }

  /** Set the handler called when a new directory is created. */
  setCreateDirectoryHandler(handler: CreateDirectoryHandler): void {
    this.onCreateDirectory = handler;
  }

  /** Set the currently active file path (highlighted in tree). */
  setActivePath(path: string | null): void {
    this.activePath = path;
    this.updateActiveHighlight();
  }

  /** Render the file tree from a root FileEntry. */
  render(root: FileEntry): void {
    this.element.innerHTML = "";
    this.focusedItem = null;
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

  /**
   * Start the inline "New Folder" name input at the root level (no parent
   * directory). Called from the sidebar header button.
   */
  startNewFolderAtRoot(): void {
    this.startNewFolderInline("");
  }

  private renderEntry(entry: FileEntry, depth: number): HTMLElement {
    const item = document.createElement("div");
    item.className = "file-tree-item";
    item.dataset.path = entry.path;
    item.style.paddingLeft = `${depth * 16 + 8}px`;
    item.setAttribute("tabindex", "-1");

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

      // Right-click context menu for directories
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showDirectoryContextMenu(e.clientX, e.clientY, entry, childContainer, icon);
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
      this.setFocusedItem(item);
      this.onSelect?.(entry.path);
    });

    item.addEventListener("keydown", (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        e.stopPropagation();
        this.startRename(item, entry.path);
      }
    });

    item.addEventListener("focus", () => {
      this.setFocusedItem(item);
    });

    return item;
  }

  /** Show a context menu for a directory item. */
  private showDirectoryContextMenu(
    x: number,
    y: number,
    entry: FileEntry,
    childContainer: HTMLElement,
    icon: HTMLElement,
  ): void {
    this.dismissContextMenu();

    const menu = document.createElement("div");
    menu.className = "file-tree-context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const newFolderItem = document.createElement("div");
    newFolderItem.className = "file-tree-context-item";
    newFolderItem.textContent = "New Folder";
    newFolderItem.addEventListener("click", (e) => {
      e.stopPropagation();
      this.dismissContextMenu();
      // Expand the directory so the inline input is visible
      childContainer.style.display = "block";
      icon.textContent = "\u25BC";
      this.startNewFolderInline(entry.path, childContainer);
    });

    menu.appendChild(newFolderItem);
    document.body.appendChild(menu);
    this.activeContextMenu = menu;

    // Prevent the document-level click listener from immediately closing it
    menu.addEventListener("click", (e) => e.stopPropagation());
  }

  /** Remove any active context menu. */
  private dismissContextMenu(): void {
    if (this.activeContextMenu) {
      this.activeContextMenu.remove();
      this.activeContextMenu = null;
    }
  }

  /**
   * Append an inline "New Folder" input row inside `container` (or at the
   * root of the tree when `container` is undefined) and handle confirmation.
   *
   * @param parentPath - The directory path that will contain the new folder,
   *   or "" for the project root.
   * @param container - The child container element to append the row into.
   *   Defaults to `this.element` (the tree root) when omitted.
   */
  private startNewFolderInline(
    parentPath: string,
    container?: HTMLElement,
  ): void {
    const host = container ?? this.element;

    // Guard: only one new-folder input at a time
    if (host.querySelector(".file-tree-new-folder-row")) return;

    const depth = parentPath
      ? parentPath.split("/").length
      : 0;

    const row = document.createElement("div");
    row.className = "file-tree-item file-tree-new-folder-row";
    row.style.paddingLeft = `${depth * 16 + 8}px`;

    const icon = document.createElement("span");
    icon.className = "file-tree-icon";
    icon.textContent = "\u25B6"; // folder icon (closed)
    row.appendChild(icon);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "file-tree-rename-input";
    input.placeholder = "Folder name";
    row.appendChild(input);

    host.appendChild(row);
    input.focus();

    let committed = false;

    const dismiss = (): void => {
      if (committed) return;
      committed = true;
      row.remove();
    };

    const confirm = async (): Promise<void> => {
      if (committed) return;
      const name = input.value.trim();

      if (!name) {
        dismiss();
        return;
      }

      if (name.includes("/") || name.includes("\\")) {
        input.setCustomValidity("Folder name cannot contain slashes.");
        input.reportValidity();
        return;
      }

      committed = true;
      row.remove();

      if (this.onCreateDirectory) {
        const newPath = parentPath ? `${parentPath}/${name}` : name;
        const err = await this.onCreateDirectory(newPath);
        if (err) {
          // Show error inline at tree root (brief error row)
          this.showNewFolderError(host, err, depth);
        }
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void confirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    });

    input.addEventListener("blur", () => {
      dismiss();
    });
  }

  /** Show a brief, dismissible error row after a failed folder creation. */
  private showNewFolderError(
    host: HTMLElement,
    message: string,
    depth: number,
  ): void {
    const row = document.createElement("div");
    row.className = "file-tree-item file-tree-new-folder-row";
    row.style.paddingLeft = `${depth * 16 + 8}px`;

    const errInput = document.createElement("input");
    errInput.type = "text";
    errInput.className = "file-tree-rename-input file-tree-rename-error";
    errInput.placeholder = message;
    errInput.title = message;
    errInput.readOnly = true;
    row.appendChild(errInput);

    host.appendChild(row);
    errInput.focus();

    const dismiss = (): void => row.remove();
    errInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "Enter") dismiss();
    });
    errInput.addEventListener("blur", dismiss);
  }

  private setFocusedItem(item: HTMLElement): void {
    if (this.focusedItem && this.focusedItem !== item) {
      this.focusedItem.classList.remove("file-tree-focused");
    }
    this.focusedItem = item;
    item.classList.add("file-tree-focused");
  }

  /** Start inline rename mode for the given item and path. */
  private startRename(item: HTMLElement, filePath: string): void {
    // Don't start if already renaming this item
    if (item.querySelector(".file-tree-rename-input")) return;

    const label = item.querySelector(".file-tree-label") as HTMLElement | null;
    if (!label) return;

    const currentName = label.textContent ?? "";
    label.style.display = "none";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "file-tree-rename-input";
    input.value = currentName;
    item.appendChild(input);

    input.focus();
    // Select the name without extension for convenience
    const dotIndex = currentName.lastIndexOf(".");
    input.setSelectionRange(0, dotIndex > 0 ? dotIndex : currentName.length);

    // Guard against blur firing after Enter triggers confirm() and removes input
    let committed = false;

    const dismiss = (): void => {
      if (committed) return;
      committed = true;
      input.remove();
      label.style.display = "";
    };

    const confirm = async (): Promise<void> => {
      if (committed) return;
      const newName = input.value.trim();

      if (!newName || newName === currentName) {
        dismiss();
        return;
      }

      // Validate: no slashes
      if (newName.includes("/") || newName.includes("\\")) {
        input.setCustomValidity("File name cannot contain slashes.");
        input.reportValidity();
        return;
      }

      // Mark committed before async work so blur doesn't also cancel
      committed = true;
      input.remove();
      label.style.display = "";

      if (this.onRename) {
        // Compute new path: replace last segment
        const dir = filePath.includes("/")
          ? filePath.substring(0, filePath.lastIndexOf("/") + 1)
          : "";
        const newPath = dir + newName;

        const err = await this.onRename(filePath, newPath);
        if (err) {
          // Show error input — user must dismiss with Escape/Enter/blur
          label.style.display = "none";
          const errInput = document.createElement("input");
          errInput.type = "text";
          errInput.className = "file-tree-rename-input file-tree-rename-error";
          errInput.value = newName;
          errInput.title = err;
          item.appendChild(errInput);
          errInput.focus();
          const dismissErr = (): void => {
            errInput.remove();
            label.style.display = "";
          };
          errInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape" || e.key === "Enter") dismissErr();
          });
          errInput.addEventListener("blur", dismissErr);
        }
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void confirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    });

    input.addEventListener("blur", () => {
      // Cancel on blur unless confirm() already took over
      dismiss();
    });
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
