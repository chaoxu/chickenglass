import { EditorView } from "@codemirror/view";

import { createEditor } from "../editor";
import type { FileSystem } from "./file-manager";
import { SearchPanel, installSearchKeybinding } from "./search-panel";
import { Sidebar } from "./sidebar";
import { TabBar } from "./tab-bar";

/** Configuration for the application shell. */
export interface AppConfig {
  /** Root DOM element to mount the app into. */
  root: HTMLElement;
  /** Filesystem backend to use. */
  fs: FileSystem;
}

/**
 * Application shell that orchestrates the sidebar, tab bar, and editor.
 *
 * Layout:
 * ```
 * +-------------------------------------------+
 * | Tab Bar [file1.md] [file2.md*]            |
 * +--------+----------------------------------+
 * | Side   | Editor (CodeMirror)              |
 * |  bar   |                                  |
 * |        |                                  |
 * +--------+----------------------------------+
 * ```
 */
export class App {
  private readonly fs: FileSystem;
  private readonly root: HTMLElement;
  private readonly sidebar: Sidebar;
  private readonly tabBar: TabBar;
  private readonly searchPanel: SearchPanel;
  private readonly cleanupSearchKeybinding: () => void;
  private readonly editorContainer: HTMLElement;
  private editor: EditorView | null = null;

  /** Content saved on disk, keyed by file path. */
  private readonly savedContent = new Map<string, string>();
  /** Content currently in the editor buffer, keyed by file path. */
  private readonly bufferContent = new Map<string, string>();

  constructor(config: AppConfig) {
    this.fs = config.fs;
    this.root = config.root;
    this.root.innerHTML = "";
    this.root.className = "app-root";

    // Tab bar across the top
    this.tabBar = new TabBar();
    this.tabBar.setSelectHandler((path) => this.activateFile(path));
    this.tabBar.setCloseHandler((path) => this.closeFile(path));
    this.root.appendChild(this.tabBar.element);

    // Main area: sidebar + editor
    const mainArea = document.createElement("div");
    mainArea.className = "app-main";

    this.sidebar = new Sidebar();
    this.sidebar.setSelectHandler((path) => this.openFile(path));
    this.sidebar.setRefreshHandler(() => this.fs.listTree());
    this.sidebar.setCreateFileHandler((path) => this.createFile(path));
    mainArea.appendChild(this.sidebar.element);

    this.editorContainer = document.createElement("div");
    this.editorContainer.className = "app-editor";
    mainArea.appendChild(this.editorContainer);

    this.root.appendChild(mainArea);

    // Search panel overlay (hidden by default)
    this.searchPanel = new SearchPanel();
    this.searchPanel.setResultHandler((entry) => this.openFile(entry.file));
    this.root.appendChild(this.searchPanel.element);

    this.cleanupSearchKeybinding = installSearchKeybinding(
      this.root,
      this.searchPanel,
    );

    this.setupKeybindings();
  }

  /** Initialize the app: load file tree and optionally open a file. */
  async init(initialFile?: string): Promise<void> {
    const tree = await this.fs.listTree();
    this.sidebar.render(tree);

    if (initialFile) {
      await this.openFile(initialFile);
    }
  }

  /** Open a file in the editor. */
  async openFile(path: string): Promise<void> {
    const name = path.split("/").pop() ?? path;

    if (this.tabBar.hasTab(path)) {
      this.activateFile(path);
      return;
    }

    const content = await this.fs.readFile(path);
    this.savedContent.set(path, content);
    this.bufferContent.set(path, content);
    this.tabBar.openTab(path, name);
    this.switchEditor(path, content);
    this.sidebar.setActivePath(path);
  }

  /** Save the currently active file. */
  async saveActiveFile(): Promise<void> {
    const activePath = this.tabBar.getActiveTab();
    if (!activePath) return;

    const content = this.bufferContent.get(activePath);
    if (content === undefined) return;

    await this.fs.writeFile(activePath, content);
    this.savedContent.set(activePath, content);
    this.tabBar.setDirty(activePath, false);
  }

  /** Create a new file and open it. */
  async createFile(path: string): Promise<void> {
    await this.fs.createFile(path, "");
    const tree = await this.fs.listTree();
    this.sidebar.render(tree);
    await this.openFile(path);
  }

  /** Get the tab bar component (for testing). */
  getTabBar(): TabBar {
    return this.tabBar;
  }

  /** Get the sidebar component (for testing). */
  getSidebar(): Sidebar {
    return this.sidebar;
  }

  /** Get the search panel component (for testing). */
  getSearchPanel(): SearchPanel {
    return this.searchPanel;
  }

  /** Clean up event listeners. */
  destroy(): void {
    this.cleanupSearchKeybinding();
    this.destroyEditor();
  }

  private activateFile(path: string): void {
    this.saveCurrentBuffer();
    this.tabBar.setActiveTab(path);
    const content = this.bufferContent.get(path) ?? "";
    this.switchEditor(path, content);
    this.sidebar.setActivePath(path);
  }

  private closeFile(path: string): void {
    const nextPath = this.tabBar.closeTab(path);
    this.savedContent.delete(path);
    this.bufferContent.delete(path);

    if (nextPath) {
      const content = this.bufferContent.get(nextPath) ?? "";
      this.switchEditor(nextPath, content);
      this.sidebar.setActivePath(nextPath);
    } else {
      this.destroyEditor();
      this.sidebar.setActivePath(null);
    }
  }

  private switchEditor(path: string, content: string): void {
    this.destroyEditor();

    const changeListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString();
        this.bufferContent.set(path, newContent);
        const saved = this.savedContent.get(path) ?? "";
        this.tabBar.setDirty(path, newContent !== saved);
      }
    });

    this.editor = createEditor({
      parent: this.editorContainer,
      doc: content,
      extensions: [changeListener],
    });
    // Expose view for debugging
    (window as unknown as { __cmView: EditorView }).__cmView = this.editor;
  }

  private destroyEditor(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  }

  private saveCurrentBuffer(): void {
    const activePath = this.tabBar.getActiveTab();
    if (!activePath || !this.editor) return;
    this.bufferContent.set(activePath, this.editor.state.doc.toString());
  }

  private setupKeybindings(): void {
    this.root.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        this.saveActiveFile();
      }
    });
  }
}
