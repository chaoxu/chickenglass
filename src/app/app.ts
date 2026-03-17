import { EditorView } from "@codemirror/view";

import { createEditor } from "../editor";
import { frontmatterField } from "../editor/frontmatter-state";
import { parseBibTeX } from "../citations/bibtex-parser";
import { bibDataEffect } from "../citations/citation-render";
import { CslProcessor } from "../citations/csl-processor";
import { expandIncludes, collapseIncludes } from "./include-expander";
import { BackgroundIndexer } from "../index";
import type { FileEntry, FileSystem } from "./file-manager";
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
  private readonly indexer: BackgroundIndexer;
  private readonly cleanupSearchKeybinding: () => void;
  private readonly editorContainer: HTMLElement;
  private editor: EditorView | null = null;
  /** Last bibliography path loaded (to avoid redundant reloads). */
  private lastBibPath = "";
  /** Last CSL style path loaded. */
  private lastCslPath = "";
  private indexUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  /** Raw content saved on disk (collapsed includes), keyed by file path. */
  private readonly savedContent = new Map<string, string>();
  /** Content currently in the editor buffer (expanded includes), keyed by file path. */
  private readonly bufferContent = new Map<string, string>();
  /** Expanded content at last save point, for dirty checking. */
  private readonly savedExpandedContent = new Map<string, string>();

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

    // Background indexer
    this.indexer = new BackgroundIndexer();

    // Search panel overlay (hidden by default)
    this.searchPanel = new SearchPanel();
    this.searchPanel.setIndexer(this.indexer);
    this.searchPanel.setResultHandler((entry) => this.openFile(entry.file));
    this.root.appendChild(this.searchPanel.element);

    this.cleanupSearchKeybinding = installSearchKeybinding(
      this.root,
      this.searchPanel,
    );

    this.setupKeybindings();
  }

  /** Initialize the app: load file tree, index all .md files, and optionally open a file. */
  async init(initialFile?: string): Promise<void> {
    const tree = await this.fs.listTree();
    this.sidebar.render(tree);

    // Collect all .md file paths from the tree and index them
    const mdPaths = collectMdPaths(tree);
    const files: Array<{ file: string; content: string }> = [];
    for (const path of mdPaths) {
      const content = await this.fs.readFile(path);
      files.push({ file: path, content });
    }
    if (files.length > 0) {
      await this.indexer.bulkUpdate(files);
    }

    if (initialFile) {
      await this.openFile(initialFile);
    }
  }

  /** Open a file in the editor, expanding any include blocks. */
  async openFile(path: string): Promise<void> {
    const name = path.split("/").pop() ?? path;

    if (this.tabBar.hasTab(path)) {
      this.activateFile(path);
      return;
    }

    const rawContent = await this.fs.readFile(path);
    // Expand include blocks so their content is editable inline
    const content = await expandIncludes(rawContent, path, this.fs);
    this.savedContent.set(path, rawContent);
    this.savedExpandedContent.set(path, content);
    this.bufferContent.set(path, content);
    this.tabBar.openTab(path, name);
    this.switchEditor(path, content);
    this.sidebar.setActivePath(path);
  }

  /** Save the currently active file, collapsing includes back to source files. */
  async saveActiveFile(): Promise<void> {
    const activePath = this.tabBar.getActiveTab();
    if (!activePath) return;

    const content = this.bufferContent.get(activePath);
    if (content === undefined) return;

    // Collapse expanded includes: extract content for each included file
    const { collapsed, regions } = collapseIncludes(content);

    // Write each included file's content
    const dir = activePath.includes("/")
      ? activePath.substring(0, activePath.lastIndexOf("/"))
      : "";
    for (const region of regions) {
      const fullPath = dir ? `${dir}/${region.path}` : region.path;
      try {
        await this.fs.writeFile(fullPath, region.content);
      } catch {
        // File might not exist yet — create it
        await this.fs.createFile(fullPath, region.content);
      }
    }

    // Write the main file with collapsed include blocks
    await this.fs.writeFile(activePath, collapsed);
    this.savedContent.set(activePath, collapsed);
    this.savedExpandedContent.set(activePath, content);
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

  /** Clean up event listeners and background worker. */
  destroy(): void {
    this.cleanupSearchKeybinding();
    this.destroyEditor();
    this.clearIndexTimer();
    this.indexer.dispose();
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
    this.savedExpandedContent.delete(path);
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
    this.lastBibPath = "";
    this.lastCslPath = "";
    this.clearIndexTimer();

    const changeListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString();
        this.bufferContent.set(path, newContent);
        const saved = this.savedExpandedContent.get(path) ?? "";
        this.tabBar.setDirty(path, newContent !== saved);
        this.scheduleIndexUpdate(path, newContent);
      }
    });

    const bibListener = EditorView.updateListener.of((update) => {
      if (update.docChanged || update.startState.field(frontmatterField, false) === undefined) {
        this.loadBibliographyIfChanged(path, update.view);
      }
    });

    this.editor = createEditor({
      parent: this.editorContainer,
      doc: content,
      extensions: [changeListener, bibListener],
    });
    // Expose view for debugging
    (window as unknown as { __cmView: EditorView }).__cmView = this.editor;

    // Initial bibliography load
    this.loadBibliographyIfChanged(path, this.editor);

    // Attach outline to the new editor
    this.sidebar.outline.attach(this.editor);
  }

  /** Load the .bib and optional .csl files specified in frontmatter. */
  private loadBibliographyIfChanged(docPath: string, view: EditorView): void {
    const fm = view.state.field(frontmatterField, false);
    const bibPath = fm?.config.bibliography ?? "";
    const cslPath = fm?.config.csl ?? "";

    if (bibPath === this.lastBibPath && cslPath === this.lastCslPath) return;
    this.lastBibPath = bibPath;
    this.lastCslPath = cslPath;

    if (!bibPath) {
      try {
        view.dispatch({ effects: bibDataEffect.of({ store: new Map(), cslProcessor: null }) });
      } catch { /* view destroyed */ }
      return;
    }

    const dir = docPath.includes("/")
      ? docPath.substring(0, docPath.lastIndexOf("/"))
      : "";
    const resolve = (p: string) => (dir ? `${dir}/${p}` : p);

    this.fs.readFile(resolve(bibPath)).then(async (bibText) => {
      const entries = parseBibTeX(bibText);
      const store = new Map(entries.map((e) => [e.id, e]));

      let cslXml: string | undefined;
      if (cslPath) {
        try {
          cslXml = await this.fs.readFile(resolve(cslPath));
        } catch {
          // CSL file not found — use default style
        }
      }

      const cslProcessor = new CslProcessor(entries, cslXml);

      try {
        view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor }) });
      } catch { /* view destroyed */ }
    }).catch(() => {
      try {
        view.dispatch({ effects: bibDataEffect.of({ store: new Map(), cslProcessor: null }) });
      } catch { /* view destroyed */ }
    });
  }

  private destroyEditor(): void {
    this.sidebar.outline.detach();
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

  /** Schedule a debounced index update for the given file. */
  private scheduleIndexUpdate(path: string, content: string): void {
    this.clearIndexTimer();
    this.indexUpdateTimer = setTimeout(() => {
      this.indexer.updateFile(path, content);
    }, 500);
  }

  /** Clear any pending index update timer. */
  private clearIndexTimer(): void {
    if (this.indexUpdateTimer !== null) {
      clearTimeout(this.indexUpdateTimer);
      this.indexUpdateTimer = null;
    }
  }
}

/** Recursively collect all .md file paths from a FileEntry tree. */
function collectMdPaths(entry: FileEntry): string[] {
  const paths: string[] = [];
  if (entry.isDirectory) {
    if (entry.children) {
      for (const child of entry.children) {
        paths.push(...collectMdPaths(child));
      }
    }
  } else if (entry.name.endsWith(".md")) {
    paths.push(entry.path);
  }
  return paths;
}
