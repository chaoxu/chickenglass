import { EditorView } from "@codemirror/view";

import { createEditor } from "../editor";
import { frontmatterField } from "../editor/frontmatter-state";
import { parseBibTeX } from "../citations/bibtex-parser";
import { bibDataEffect } from "../citations/citation-render";
import { CslProcessor } from "../citations/csl-processor";
import { resolveIncludePath } from "../plugins/include-resolver";
import { SourceMap, type IncludeRegion } from "./source-map";
import { BackgroundIndexer } from "../index";
import type { FileEntry, FileSystem } from "./file-manager";
import { exportDocument, type ExportFormat } from "./export";
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
  private static readonly INCLUDE_RE =
    /^(:{3,})\s*\{\.include\}\s*\n\s*(.+?)\s*\n\1\s*$/gm;

  /** Raw content saved on disk (collapsed includes), keyed by file path. */
  private readonly savedContent = new Map<string, string>();
  /** Content currently in the editor buffer (expanded includes), keyed by file path. */
  private readonly bufferContent = new Map<string, string>();
  /** Expanded content at last save point, for dirty checking. */
  private readonly savedExpandedContent = new Map<string, string>();
  /** Source maps for include tracking, keyed by file path. */
  private readonly sourceMaps = new Map<string, SourceMap>();

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

    this.root.addEventListener("cg-open-file", (e) => {
      const path = (e as CustomEvent).detail;
      if (typeof path === "string") this.openFile(path);
    });
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
    const { composed: content, sourceMap } = await this.expandIncludes(path, rawContent);
    this.sourceMaps.set(path, sourceMap);
    (window as unknown as { __cgSourceMap: SourceMap | null }).__cgSourceMap = sourceMap;
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

    const sourceMap = this.sourceMaps.get(activePath);
    if (sourceMap && sourceMap.regions.length > 0) {
      const fileParts = sourceMap.decompose(content);
      for (const [filePath, fileContent] of fileParts) {
        try { await this.fs.writeFile(filePath, fileContent); }
        catch { await this.fs.createFile(filePath, fileContent); }
      }
      const mainContent = sourceMap.reconstructMain(content, activePath);
      await this.fs.writeFile(activePath, mainContent);
      this.savedContent.set(activePath, mainContent);
    } else {
      await this.fs.writeFile(activePath, content);
      this.savedContent.set(activePath, content);
    }
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
    this.sourceMaps.delete(path);

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
    const basename = path.split("/").pop() ?? path;
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
        this.sourceMaps.get(path)?.mapThrough(update.changes);
      }
    });

    const bibListener = EditorView.updateListener.of((update) => {
      if (update.docChanged || update.startState.field(frontmatterField, false) === undefined) {
        this.loadBibliographyIfChanged(path, update.view);
      }
    });

    const titleListener = EditorView.updateListener.of((update) => {
      if (update.docChanged || update.startState.field(frontmatterField, false) === undefined) {
        const fm = update.state.field(frontmatterField, false);
        const displayName = fm?.config.title ?? basename;
        this.tabBar.updateName(path, displayName);
        document.title = fm?.config.title
          ? `${fm.config.title} — Chickenglass`
          : "Chickenglass";
      }
    });

    this.editor = createEditor({
      parent: this.editorContainer,
      doc: content,
      extensions: [changeListener, bibListener, titleListener],
    });
    // Expose view for debugging
    (window as unknown as { __cmView: EditorView }).__cmView = this.editor;

    // Initial bibliography load
    this.loadBibliographyIfChanged(path, this.editor);

    // Initial title update (listener only fires on changes, not initial state)
    const initialFm = this.editor.state.field(frontmatterField, false);
    const initialName = initialFm?.config.title ?? basename;
    this.tabBar.updateName(path, initialName);
    if (initialFm?.config.title) {
      document.title = `${initialFm.config.title} — Chickenglass`;
    }

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

  private async expandIncludes(
    mainPath: string,
    rawContent: string,
  ): Promise<{ composed: string; sourceMap: SourceMap }> {
    const re = new RegExp(App.INCLUDE_RE.source, App.INCLUDE_RE.flags);
    const matches: Array<{ fullMatch: string; start: number; end: number; resolvedPath: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawContent)) !== null) {
      const filePath = m[2].trim();
      matches.push({ fullMatch: m[0], start: m.index, end: m.index + m[0].length,
        resolvedPath: resolveIncludePath(mainPath, filePath) });
    }
    if (matches.length === 0) return { composed: rawContent, sourceMap: new SourceMap([]) };

    const fileContents = new Map<string, string>();
    for (const { resolvedPath, fullMatch } of matches) {
      if (!fileContents.has(resolvedPath)) {
        try { fileContents.set(resolvedPath, await this.fs.readFile(resolvedPath)); }
        catch { fileContents.set(resolvedPath, fullMatch); }
      }
    }

    const regions: IncludeRegion[] = [];
    let composed = rawContent;
    let offset = 0;
    for (const { fullMatch, start, end, resolvedPath } of matches) {
      const fileContent = fileContents.get(resolvedPath) ?? fullMatch;
      const adjStart = start + offset;
      composed = composed.substring(0, adjStart) + fileContent + composed.substring(adjStart + (end - start));
      regions.push({ from: adjStart, to: adjStart + fileContent.length,
        file: resolvedPath, originalRef: fullMatch, rawFrom: start, rawTo: end });
      offset += fileContent.length - fullMatch.length;
    }
    return { composed, sourceMap: new SourceMap(regions) };
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

  /** Export the active document to PDF or LaTeX via Pandoc. */
  async exportActiveFile(format: ExportFormat): Promise<void> {
    const activePath = this.tabBar.getActiveTab();
    if (!activePath || !this.editor) return;

    // Use the current editor content (includes already expanded)
    const content = this.editor.state.doc.toString();

    try {
      const outputPath = await exportDocument(content, format, activePath);
      // Show a brief success notification
      this.showNotification(`Exported to ${outputPath}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.showNotification(`Export failed: ${message}`, true);
    }
  }

  /** Show a temporary notification bar at the top of the editor. */
  private showNotification(message: string, isError = false): void {
    const bar = document.createElement("div");
    bar.className = `app-notification${isError ? " app-notification-error" : ""}`;
    bar.textContent = message;
    this.editorContainer.prepend(bar);
    setTimeout(() => bar.remove(), 5000);
  }

  private setupKeybindings(): void {
    this.root.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        this.saveActiveFile();
      }
      // Cmd+Shift+E / Ctrl+Shift+E → Export to PDF
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "E") {
        e.preventDefault();
        this.exportActiveFile("pdf");
      }
      // Cmd+Shift+L / Ctrl+Shift+L → Export to LaTeX
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "L") {
        e.preventDefault();
        this.exportActiveFile("latex");
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
