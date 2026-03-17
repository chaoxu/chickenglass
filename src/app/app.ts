import { EditorView } from "@codemirror/view";

import { createEditor } from "../editor";
import { resolveIncludePath } from "../plugins/include-resolver";
import type { FileSystem } from "./file-manager";
import { SearchPanel, installSearchKeybinding } from "./search-panel";
import { Sidebar } from "./sidebar";
import { SourceMap, type IncludeRegion } from "./source-map";
import { TabBar } from "./tab-bar";

/**
 * Regex matching the collapsed include form:
 * ```
 * ::: {.include}
 * chapter1.md
 * :::
 * ```
 */
const INCLUDE_RE = /^(:{3,})\s*\{\.include\}\s*\n\s*(.+?)\s*\n\1\s*$/gm;

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

  /** Source map for the currently open file (null if no includes). */
  private sourceMap: SourceMap | null = null;

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

  /** Open a file in the editor, expanding includes inline via SourceMap. */
  async openFile(path: string): Promise<void> {
    const name = path.split("/").pop() ?? path;

    if (this.tabBar.hasTab(path)) {
      this.activateFile(path);
      return;
    }

    const rawContent = await this.fs.readFile(path);
    const { composed, sourceMap } = await this.expandIncludes(
      path,
      rawContent,
    );

    this.sourceMap = sourceMap;
    this.savedContent.set(path, composed);
    this.bufferContent.set(path, composed);
    this.tabBar.openTab(path, name);
    this.switchEditor(path, composed);
    this.sidebar.setActivePath(path);
  }

  /** Save the currently active file, decomposing includes back to separate files. */
  async saveActiveFile(): Promise<void> {
    const activePath = this.tabBar.getActiveTab();
    if (!activePath) return;

    const content = this.bufferContent.get(activePath);
    if (content === undefined) return;

    if (this.sourceMap && this.sourceMap.regions.length > 0) {
      // Decompose: extract each included file's content and write it
      const fileParts = this.sourceMap.decompose(content);
      for (const [filePath, fileContent] of fileParts) {
        await this.fs.writeFile(filePath, fileContent);
      }

      // Reconstruct the main file with include references restored
      const mainContent = this.sourceMap.reconstructMain(content, activePath);
      await this.fs.writeFile(activePath, mainContent);
      this.savedContent.set(activePath, content);
    } else {
      // No includes: save directly
      await this.fs.writeFile(activePath, content);
      this.savedContent.set(activePath, content);
    }

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

  /** Get the current source map (for CM6 extensions and testing). */
  getSourceMap(): SourceMap | null {
    return this.sourceMap;
  }

  /** Clean up event listeners. */
  destroy(): void {
    this.cleanupSearchKeybinding();
    this.destroyEditor();
  }

  /**
   * Expand include references in the raw content, building a SourceMap.
   *
   * Finds all `::: {.include}\npath\n:::` blocks, reads the included files,
   * replaces the references with file content, and records each region.
   */
  private async expandIncludes(
    mainPath: string,
    rawContent: string,
  ): Promise<{ composed: string; sourceMap: SourceMap }> {
    const re = new RegExp(INCLUDE_RE.source, INCLUDE_RE.flags);
    const matches: Array<{
      fullMatch: string;
      start: number;
      end: number;
      filePath: string;
      resolvedPath: string;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = re.exec(rawContent)) !== null) {
      const filePath = match[2].trim();
      const resolvedPath = resolveIncludePath(mainPath, filePath);
      matches.push({
        fullMatch: match[0],
        start: match.index,
        end: match.index + match[0].length,
        filePath,
        resolvedPath,
      });
    }

    if (matches.length === 0) {
      return { composed: rawContent, sourceMap: new SourceMap([]) };
    }

    // Read all included files
    const fileContents = new Map<string, string>();
    for (const m of matches) {
      if (!fileContents.has(m.resolvedPath)) {
        const exists = await this.fs.exists(m.resolvedPath);
        if (exists) {
          const content = await this.fs.readFile(m.resolvedPath);
          fileContents.set(m.resolvedPath, content);
        } else {
          // If file not found, leave the include reference as-is
          fileContents.set(m.resolvedPath, m.fullMatch);
        }
      }
    }

    // Build composed document and regions by replacing in reverse order
    // to preserve offsets for earlier matches
    const regions: IncludeRegion[] = [];
    let composed = rawContent;
    let offset = 0; // cumulative offset from replacements

    for (const m of matches) {
      const content = fileContents.get(m.resolvedPath) ?? m.fullMatch;
      const adjustedStart = m.start + offset;
      const adjustedEnd = m.end + offset;

      // Replace the include reference with file content
      composed =
        composed.substring(0, adjustedStart) +
        content +
        composed.substring(adjustedEnd);

      regions.push({
        from: adjustedStart,
        to: adjustedStart + content.length,
        file: m.resolvedPath,
        originalRef: m.fullMatch,
        rawFrom: m.start,
        rawTo: m.end,
      });

      // Update offset: content length minus original match length
      offset += content.length - m.fullMatch.length;
    }

    return { composed, sourceMap: new SourceMap(regions) };
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
      this.sourceMap = null;
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

        // Keep the source map in sync with document changes
        this.sourceMap?.mapThrough(update.changes);
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
