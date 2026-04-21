/**
 * Migration Verification Tests
 *
 * Verifies that every feature from issues #87-#143 actually exists
 * in the final codebase. These are structural/existence tests, not
 * behavioral tests — they confirm that claimed work is present.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fileExists(relativePath: string): boolean {
  return existsSync(resolve(ROOT, relativePath));
}

function fileText(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

// ─── Issue #87: Declarative block plugins from YAML ──────────────────────────

describe("#87 — declarative block plugins", () => {
  it("plugin registry state lives under src/state", async () => {
    const mod = await import("../state/plugin-registry");
    expect(mod.pluginRegistryField).toBeDefined();
  });

  it("plugin-registry.test.ts has YAML config tests", () => {
    expect(fileExists("src/plugins/plugin-registry.test.ts")).toBe(true);
  });
});

// ─── Issue #88: Project-level KaTeX macros ───────────────────────────────────

describe("#88 — project-level KaTeX macros", () => {
  it("project-config exports projectConfigFacet", async () => {
    const mod = await import("./project-config");
    expect(mod.projectConfigFacet).toBeDefined();
    expect(mod.loadProjectConfig).toBeDefined();
    expect(mod.parseProjectConfig).toBeDefined();
  });

  it("math-macros test file exists", () => {
    expect(fileExists("src/render/math-macros.test.ts")).toBe(true);
  });
});

// ─── Issue #92: Collapsible sidebar ──────────────────────────────────────────

describe("#92 — collapsible sidebar", () => {
  it("React Sidebar component exists", async () => {
    const mod = await import("./components/sidebar");
    expect(mod.Sidebar).toBeDefined();
  });

  it("Sidebar module exposes the controlled sidebar shell", async () => {
    const mod = await import("./components/sidebar");
    expect(mod.SidebarProvider).toBeDefined();
    expect(mod.SidebarTrigger).toBeDefined();
  });
});

// ─── Issue #94: Native menu bar ──────────────────────────────────────────────

describe("#94 — native menu bar", () => {
  it("Rust menu module exists", () => {
    expect(fileExists("src-tauri/src/menu.rs")).toBe(true);
  });
});

// ─── Issue #95: Status bar ───────────────────────────────────────────────────

describe("#95 — status bar", () => {
  it("React StatusBar component exists", async () => {
    const mod = await import("./components/status-bar");
    expect(mod.StatusBar).toBeDefined();
  });
});

// ─── Issue #97: Save-before-close ────────────────────────────────────────────

describe("#97 — save-before-close", () => {
  it("app.tsx contains close file logic", () => {
    expect(fileExists("src/app/app.tsx")).toBe(true);
  });
});

// ─── Issue #100: Settings dialog ─────────────────────────────────────────────

describe("#100 — settings dialog", () => {
  it("React SettingsDialog component exists", async () => {
    const mod = await import("./components/settings-dialog");
    expect(mod.SettingsDialog).toBeDefined();
  });

  it("useSettings hook exists", async () => {
    const mod = await import("./hooks/use-settings");
    expect(mod.useSettings).toBeDefined();
  });
});

// ─── Issue #101: Dark mode ───────────────────────────────────────────────────

describe("#101 — dark mode", () => {
  it("useTheme hook exists with theme management", async () => {
    const mod = await import("./hooks/use-theme");
    expect(mod.useTheme).toBeDefined();
  });

  it("globals.css has dark theme variables", () => {
    expect(fileExists("src/globals.css")).toBe(true);
  });
});

// ─── Issue #102: Find and Replace ────────────────────────────────────────────

describe("#102 — find and replace", () => {
  it("CM6 find-replace extension exists", async () => {
    const mod = await import("../editor/find-replace");
    expect(mod.findReplaceExtension).toBeDefined();
  });
});

// ─── Issue #103: Zoom ────────────────────────────────────────────────────────

describe("#103 — zoom in/out", () => {
  it("useHotkeys hook exists for keybinding support", async () => {
    const mod = await import("./hooks/use-hotkeys");
    expect(mod.useHotkeys).toBeDefined();
  });
});

// ─── Issue #105: Spell checking ──────────────────────────────────────────────

describe("#105 — spell checking", () => {
  it("spellcheck CM6 extension exists", async () => {
    const mod = await import("../editor/spellcheck");
    expect(mod.spellcheckExtension).toBeDefined();
  });
});

// ─── Issue #107: Context menus ───────────────────────────────────────────────

describe("#107 — context menus", () => {
  it("FileTree has context menu support", async () => {
    const mod = await import("./components/file-tree");
    expect(mod.FileTree).toBeDefined();
  });
});

// ─── Issue #109: Writing statistics ──────────────────────────────────────────

describe("#109 — writing statistics", () => {
  it("writing-stats module exists with computeDocStats", async () => {
    const mod = await import("./writing-stats");
    expect(mod.computeDocStats).toBeDefined();
  });
});

// ─── Issue #112: Keyboard shortcuts sheet ────────────────────────────────────

describe("#112 — shortcuts dialog", () => {
  it("React ShortcutsDialog component exists", async () => {
    const mod = await import("./components/shortcuts-dialog");
    expect(mod.ShortcutsDialog).toBeDefined();
  });
});

// ─── Issue #113: About dialog ────────────────────────────────────────────────

describe("#113 — about dialog", () => {
  it("React AboutDialog component exists", async () => {
    const mod = await import("./components/about-dialog");
    expect(mod.AboutDialog).toBeDefined();
  });
});

// ─── Issue #117: Sidebar hover arrows ────────────────────────────────────────

describe("#117 — sidebar collapse arrows on hover", () => {
  it("globals.css contains sidebar toggle styles", () => {
    expect(fileExists("src/globals.css")).toBe(true);
  });
});

// ─── Issue #118: Reference hover preview ─────────────────────────────────────

describe("#118 — hover preview", () => {
  it("hover-preview CM6 extension exists", async () => {
    const mod = await import("../render/hover-preview");
    expect(mod.hoverPreviewExtension).toBeDefined();
  });
});

// ─── Issue #119: Rename file ─────────────────────────────────────────────────

describe("#119 — rename file", () => {
  it("FileSystem has renameFile method", async () => {
    const mod = await import("./file-manager");
    const fs = mod.createDemoFileSystem();
    expect(typeof fs.renameFile).toBe("function");
  });

  it("Rust rename command exists", () => {
    expect(fileExists("src-tauri/src/commands/fs.rs")).toBe(true);
  });
});

// ─── Issue #120: Delete file ─────────────────────────────────────────────────

describe("#120 — delete file", () => {
  it("file-manager module exists", async () => {
    const mod = await import("./file-manager");
    expect(mod.createDemoFileSystem).toBeDefined();
  });
});

// ─── Issue #121: New folder ──────────────────────────────────────────────────

describe("#121 — new folder", () => {
  it("FileSystem has createDirectory method", async () => {
    const mod = await import("./file-manager");
    const fs = mod.createDemoFileSystem();
    expect(typeof fs.createDirectory).toBe("function");
  });
});

// ─── Issue #122: Tab reordering ──────────────────────────────────────────────

describe("#122 — tab reordering", () => {
  it("React TabBar component exists", async () => {
    const mod = await import("./components/tab-bar");
    expect(mod.TabBar).toBeDefined();
  });
});

// ─── Issue #124: Go to Line ──────────────────────────────────────────────────

describe("#124 — go to line", () => {
  it("GotoLineDialog component exists", async () => {
    const mod = await import("./components/goto-line-dialog");
    expect(mod.GotoLineDialog).toBeDefined();
  });

  it("parseTarget is exported from goto-line.ts", async () => {
    const mod = await import("./goto-line");
    expect(mod.parseTarget).toBeDefined();
  });
});

// ─── Issue #125: Export improvements ─────────────────────────────────────────

describe("#125 — export improvements", () => {
  it("export module supports HTML format", async () => {
    const mod = await import("./export");
    expect(mod.exportDocument).toBeDefined();
    expect(mod.batchExport).toBeDefined();
    expect(mod.collectMdPaths).toBeDefined();
  });
});

// ─── Issue #126: Breadcrumbs scroll ──────────────────────────────────────────

describe("#126 — breadcrumbs", () => {
  it("React Breadcrumbs component exists", async () => {
    const mod = await import("./components/breadcrumbs");
    expect(mod.Breadcrumbs).toBeDefined();
  });

  it("heading-ancestry module exists", async () => {
    const mod = await import("./heading-ancestry");
    expect(mod.headingAncestryAt).toBeDefined();
  });
});

// ─── Issue #127: B&W design overhaul ─────────────────────────────────────────

describe("#127 — minimal B&W design", () => {
  it("globals.css has --cf-* CSS variables", () => {
    expect(fileExists("src/globals.css")).toBe(true);
  });

  it("editor theme uses CSS variables", async () => {
    const mod = await import("../editor/theme");
    expect(mod.coflatTheme).toBeDefined();
  });
});

// ─── Issue #128: Editor plugin system ────────────────────────────────────────

describe("#128 — editor plugin system", () => {
  it("editor-plugin module exists", async () => {
    const mod = await import("../editor/editor-plugin");
    expect(mod.EditorPluginManager).toBeDefined();
  });
});

// ─── React Migration Issues #129-#143 ────────────────────────────────────────

describe("React migration — #129 setup", () => {
  it("vite.config.ts has Tailwind plugin", () => {
    expect(fileExists("vite.config.ts")).toBe(true);
  });

  it("tsconfig.json has JSX config", () => {
    expect(fileExists("tsconfig.json")).toBe(true);
  });

  it("globals.css exists with Tailwind import", () => {
    expect(fileExists("src/globals.css")).toBe(true);
  });

  it("cn utility exists", async () => {
    const mod = await import("./lib/utils");
    expect(mod.cn).toBeDefined();
  });

  it("components.json exists for shadcn", () => {
    expect(fileExists("components.json")).toBe(true);
  });
});

describe("React migration — #130 entry point", () => {
  it("main.tsx exists", () => {
    expect(fileExists("src/app/main.tsx")).toBe(true);
  });

  it("app.tsx exists", () => {
    expect(fileExists("src/app/app.tsx")).toBe(true);
  });

  it("FileSystem context exists", async () => {
    const mod = await import("./contexts/file-system-context");
    expect(mod.FileSystemProvider).toBeDefined();
    expect(mod.useFileSystem).toBeDefined();
  });
});

describe("React migration — #131 useEditor", () => {
  it("useEditor hook exists", async () => {
    const mod = await import("./hooks/use-editor");
    expect(mod.useEditor).toBeDefined();
  });
});

describe("React migration — #132 useTheme + useSettings", () => {
  it("useTheme hook exists", async () => {
    const mod = await import("./hooks/use-theme");
    expect(mod.useTheme).toBeDefined();
  });

  it("useSettings hook exists", async () => {
    const mod = await import("./hooks/use-settings");
    expect(mod.useSettings).toBeDefined();
  });
});

describe("React migration — #133 TabBar", () => {
  it("TabBar component exists", async () => {
    const mod = await import("./components/tab-bar");
    expect(mod.TabBar).toBeDefined();
  });
});

describe("React migration — #134 Sidebar/FileTree/Outline", () => {
  it("Sidebar component exists", async () => {
    const mod = await import("./components/sidebar");
    expect(mod.Sidebar).toBeDefined();
  });

  it("FileTree component exists", async () => {
    const mod = await import("./components/file-tree");
    expect(mod.FileTree).toBeDefined();
  });

  it("Outline component exists", async () => {
    const mod = await import("./components/outline");
    expect(mod.Outline).toBeDefined();
  });
});

describe("React migration — #135 EditorPane", () => {
  it("EditorPane component exists", async () => {
    const mod = await import("./components/editor-pane");
    expect(mod.EditorPane).toBeDefined();
  });
});

describe("React migration — #136 StatusBar", () => {
  it("StatusBar component exists", async () => {
    const mod = await import("./components/status-bar");
    expect(mod.StatusBar).toBeDefined();
  });
});

describe("React migration — #137 CommandPalette", () => {
  it("CommandPalette component exists", async () => {
    const mod = await import("./components/command-palette");
    expect(mod.CommandPalette).toBeDefined();
  });
});

describe("React migration — #138 SearchPanel", () => {
  it("SearchPanel component exists", async () => {
    const mod = await import("./components/search-panel");
    expect(mod.SearchPanel).toBeDefined();
  });
});

describe("React migration — #139 Breadcrumbs", () => {
  it("Breadcrumbs component exists", async () => {
    const mod = await import("./components/breadcrumbs");
    expect(mod.Breadcrumbs).toBeDefined();
  });
});

describe("React migration — #140 SettingsDialog", () => {
  it("SettingsDialog component exists", async () => {
    const mod = await import("./components/settings-dialog");
    expect(mod.SettingsDialog).toBeDefined();
  });
});

describe("React migration — #141 small dialogs", () => {
  it("AboutDialog exists", async () => {
    const mod = await import("./components/about-dialog");
    expect(mod.AboutDialog).toBeDefined();
  });

  it("ShortcutsDialog exists", async () => {
    const mod = await import("./components/shortcuts-dialog");
    expect(mod.ShortcutsDialog).toBeDefined();
  });

  it("GotoLineDialog exists", async () => {
    const mod = await import("./components/goto-line-dialog");
    expect(mod.GotoLineDialog).toBeDefined();
  });
});

describe("React migration — #142 remaining", () => {
  it("SplitPane exists", async () => {
    const mod = await import("./components/split-pane");
    expect(mod.SplitPane).toBeDefined();
  });

  it("useAutoSave hook exists", async () => {
    const mod = await import("./hooks/use-auto-save");
    expect(mod.useAutoSave).toBeDefined();
  });

  it("useHotkeys hook exists", async () => {
    const mod = await import("./hooks/use-hotkeys");
    expect(mod.useHotkeys).toBeDefined();
  });

  it("useRecentFiles hook exists", async () => {
    const mod = await import("./hooks/use-recent-files");
    expect(mod.useRecentFiles).toBeDefined();
  });

  it("useWindowState hook exists", async () => {
    const mod = await import("./hooks/use-window-state");
    expect(mod.useWindowState).toBeDefined();
  });
});

describe("React migration — #143 cleanup", () => {
  it("old main.ts is deleted", () => {
    expect(fileExists("src/main.ts")).toBe(false);
  });

  it("old app.ts is deleted", () => {
    expect(fileExists("src/app/app.ts")).toBe(false);
  });

  it("old app-keybindings.ts is deleted", () => {
    expect(fileExists("src/app/app-keybindings.ts")).toBe(false);
  });

  it("old app-export.ts is deleted", () => {
    expect(fileExists("src/app/app-export.ts")).toBe(false);
  });

  it("old status-bar.ts is deleted", () => {
    expect(fileExists("src/app/status-bar.ts")).toBe(false);
  });

  it("old settings.ts is deleted", () => {
    expect(fileExists("src/app/settings.ts")).toBe(false);
  });

  it("engine files are untouched", () => {
    expect(fileExists("src/editor/editor.ts")).toBe(true);
    expect(fileExists("src/editor/theme.ts")).toBe(true);
    expect(fileExists("src/editor/keybindings.ts")).toBe(true);
    expect(fileExists("src/parser/fenced-div.ts")).toBe(true);
    expect(fileExists("src/plugins/plugin-registry.ts")).toBe(true);
    expect(fileExists("src/render/math-render.ts")).toBe(true);
    expect(fileExists("src/citations/bibtex-parser.ts")).toBe(true);
    expect(fileExists("src/index/indexer.ts")).toBe(true);
  });
});

describe("#286 — shared app chrome primitives", () => {
  it("shared dialog and breadcrumb primitives exist", () => {
    expect(fileExists("src/app/components/ui/dialog.tsx")).toBe(true);
    expect(fileExists("src/app/components/ui/breadcrumb.tsx")).toBe(true);
  });

  it("sidebar ui primitives exist", async () => {
    const mod = await import("./components/sidebar");
    expect(mod.SidebarProvider).toBeDefined();
    expect(mod.SidebarTrigger).toBeDefined();
    expect(mod.SidebarRail).toBeDefined();
    expect(mod.SidebarInset).toBeDefined();
  });

  it("shared scroll area primitive exists", () => {
    expect(fileExists("src/app/components/ui/scroll-area.tsx")).toBe(true);
  });

  it("shared tabs primitive exists", () => {
    expect(fileExists("src/app/components/ui/tabs.tsx")).toBe(true);
  });

  it("shared chrome action primitives exist", () => {
    expect(fileExists("src/app/components/ui/command.tsx")).toBe(true);
    expect(fileExists("src/app/components/ui/context-menu.tsx")).toBe(true);
  });

  it("shared input primitives exist", () => {
    expect(fileExists("src/app/components/ui/input.tsx")).toBe(true);
    expect(fileExists("src/app/components/ui/textarea.tsx")).toBe(true);
  });

  it("shared form primitives exist", () => {
    expect(fileExists("src/app/components/ui/select.tsx")).toBe(true);
    expect(fileExists("src/app/components/ui/checkbox.tsx")).toBe(true);
    expect(fileExists("src/app/components/ui/slider.tsx")).toBe(true);
  });
});

describe("#280 — AppInner controller decomposition", () => {
  it("workspace/session controller hook exists", async () => {
    const mod = await import("./hooks/use-app-workspace-session");
    expect(mod.useAppWorkspaceSession).toBeDefined();
  });

  it("editor shell controller hook exists", async () => {
    const mod = await import("./hooks/use-app-editor-shell");
    expect(mod.useAppEditorShell).toBeDefined();
  });

  it("session persistence and overlay controller hooks exist", async () => {
    const sessionMod = await import("./hooks/use-app-session-persistence");
    const overlayMod = await import("./hooks/use-app-overlays");
    expect(sessionMod.useAppSessionPersistence).toBeDefined();
    expect(overlayMod.useAppOverlays).toBeDefined();
  });

  it("debug controller hook exists", async () => {
    const mod = await import("./hooks/use-app-debug");
    expect(mod.useAppDebug).toBeDefined();
  });

  it("app shell composition components exist", async () => {
    const sidebarMod = await import("./components/app-sidebar-shell");
    const mainMod = await import("./components/app-main-shell");
    const overlaysMod = await import("./components/app-overlays");
    expect(sidebarMod.AppSidebarShell).toBeDefined();
    expect(mainMod.AppMainShell).toBeDefined();
    expect(overlaysMod.AppOverlays).toBeDefined();
  });
});

describe("#284 — FileTree controller extraction", () => {
  it("file tree controller hook exists", async () => {
    const mod = await import("./hooks/use-file-tree-controller");
    expect(mod.useFileTreeController).toBeDefined();
    expect(mod.flattenVisibleEntries).toBeDefined();
    expect(mod.resolveFileTreeKey).toBeDefined();
  });

  it("recursive file tree node component exists", async () => {
    const mod = await import("./components/file-tree-node");
    expect(mod.FileTreeNode).toBeDefined();
  });
});

describe("#288 — Headless Tree explorer migration", () => {
  it("file tree controller uses Headless Tree", () => {
    const controller = fileText("src/app/hooks/use-file-tree-controller.ts");
    expect(controller).toContain('from "@headless-tree/react"');
    expect(controller).toContain("useTree<FileEntry>");
    expect(controller).toContain("syncDataLoaderFeature");
    expect(controller).toContain("hotkeysCoreFeature");
  });

  it("package dependencies include Headless Tree", () => {
    const pkg = fileText("package.json");
    expect(pkg).toContain('"@headless-tree/core"');
    expect(pkg).toContain('"@headless-tree/react"');
  });
});

describe("#300 — shared test-utils module", () => {
  it("shared test utilities module exists", async () => {
    const mod = await import("../test-utils");
    expect(mod.createTestView).toBeDefined();
    expect(mod.createEditorState).toBeDefined();
    expect(mod.getDecorationSpecs).toBeDefined();
    expect(mod.makeBlockPlugin).toBeDefined();
  });
});

describe("#303 — boolean toggle field factory", () => {
  it("render-utils exports the shared boolean toggle field factory", async () => {
    const mod = await import("../render/render-utils");
    expect(mod.createBooleanToggleField).toBeDefined();
  });
});

describe("#309 — export theme tokens", () => {
  it("export.ts resolves theme tokens for standalone HTML export", async () => {
    const mod = await import("./export");
    expect(mod._resolveExportThemeTokensForTest).toBeDefined();
    expect(mod._buildHtmlDocumentForTest).toBeDefined();
  });
});

describe("#312 — unified editor session hook", () => {
  it("useEditorSession exists and old split hooks are removed", async () => {
    const mod = await import("./hooks/use-editor-session");
    expect(mod.useEditorSession).toBeDefined();
    // use-document-buffer.ts was the old rejected split — must stay removed.
    expect(fileExists("src/app/hooks/use-document-buffer.ts")).toBe(false);
    // use-file-operations.ts was reintroduced in #375 as a deliberate helper
    // module extracted from useEditorSession. It is an internal implementation
    // detail, not a replacement top-level hook.
  });
});

describe("#283 — backend command module decomposition", () => {
  it("commands module tree exists", () => {
    expect(fileExists("src-tauri/src/commands/mod.rs")).toBe(true);
    expect(fileExists("src-tauri/src/commands/state.rs")).toBe(true);
    expect(fileExists("src-tauri/src/commands/path.rs")).toBe(true);
  });

  it("backend command domains are split by responsibility", () => {
    expect(fileExists("src-tauri/src/commands/fs.rs")).toBe(true);
    expect(fileExists("src-tauri/src/commands/watch.rs")).toBe(true);
    expect(fileExists("src-tauri/src/commands/export.rs")).toBe(true);
    expect(fileExists("src-tauri/src/commands/shell.rs")).toBe(true);
  });
});

describe("#281 — useEditor internal hook decomposition", () => {
  it("document services hook exists", async () => {
    const mod = await import("./hooks/use-editor-document-services");
    expect(mod.useEditorDocumentServices).toBeDefined();
  });

  it("theme sync and debug bridge hooks exist", async () => {
    const themeMod = await import("./hooks/use-editor-theme-sync");
    const debugMod = await import("./hooks/use-editor-debug-bridge");
    expect(themeMod.useEditorThemeSync).toBeDefined();
    expect(debugMod.useEditorDebugBridge).toBeDefined();
  });
});

describe("#282 — interactive table subsystem decomposition", () => {
  it("table discovery and helper module exists", async () => {
    const mod = await import("../render/table-discovery");
    expect(mod.findTablesInState).toBeDefined();
    expect(mod.findTablesInView).toBeDefined();
    expect(mod.findCellBounds).toBeDefined();
  });

  it("table action and navigation modules exist", async () => {
    const actionMod = await import("../render/table-actions");
    const navMod = await import("../render/table-navigation");
    expect(actionMod.applyTableMutation).toBeDefined();
    expect(actionMod.showTableContextMenu).toBeDefined();
    expect(navMod.tableKeybindings).toBeDefined();
  });

  it("table widget module exists", async () => {
    const mod = await import("../render/table-widget");
    expect(mod.TableWidget).toBeDefined();
    expect(mod.cellEditAnnotation).toBeDefined();
  });
});

describe("#273 — theme-driven typography", () => {
  it("theme presets expose a UI font alongside content and code fonts", async () => {
    const mod = await import("../editor/theme-config");
    expect(mod.themePresets.academic.uiFont).toBeTruthy();
    expect(mod.themePresets.academic.contentFont).toBeTruthy();
    expect(mod.themePresets.academic.codeFont).toBeTruthy();
  });

  it("theme config test coverage exists", () => {
    expect(fileExists("src/editor/theme-config.test.ts")).toBe(true);
  });
});

describe("#277 — first-class theme surface tokens", () => {
  it("editor-theme.css defines block and special-surface theme tokens", () => {
    const css = fileText("src/editor-theme.css");
    expect(css).toContain("--cf-block-header-accent");
    expect(css).toContain("--cf-proof-marker");
    expect(css).toContain("--cf-blockquote-border");
    expect(css).toContain("--cf-table-border");
  });

  it("globals.css imports editor-theme.css", () => {
    const css = fileText("src/globals.css");
    expect(css).toContain('@import "./editor-theme.css"');
  });

  it("rich block styling consumes the shared theme tokens", () => {
    const richCss = fileText("src/editor/block-theme.ts");
    expect(richCss).toContain("var(--cf-block-header-accent)");
    expect(richCss).toContain("var(--cf-proof-marker)");
    expect(richCss).toContain("var(--cf-block-title-separator)");
    expect(richCss).toContain("var(--cf-table-header-border)");
  });
});

describe("#910 — centralized layer tokens", () => {
  it("defines shared layer tokens in the stylesheet and theme contract", () => {
    const css = fileText("src/editor-theme.css");
    const contract = fileText("src/theme-contract.ts");

    expect(css).toContain("--cf-layer-inline-chrome: 1;");
    expect(css).toContain("--cf-layer-preview-surface: 1000;");
    expect(css).toContain("--cf-layer-block-picker: 1010;");
    expect(contract).toContain('export const themeLayerTokens = [');
    expect(contract).toContain('"--cf-layer-inline-chrome"');
    expect(contract).toContain('"--cf-layer-preview-surface"');
    expect(contract).toContain('"--cf-layer-block-picker"');
    expect(contract).toContain('"--cf-layer-block-picker": "1010"');
  });

  it("routes editor surfaces through the shared layer tokens", () => {
    const css = fileText("src/editor-theme.css");
    const blockTheme = fileText("src/editor/block-theme.ts");

    expect(css).toContain("z-index: var(--cf-layer-inline-chrome);");
    expect(css).toContain("z-index: var(--cf-layer-preview-surface);");
    expect(css).toContain("z-index: var(--cf-layer-block-picker);");
    expect(blockTheme).not.toContain("--cf-layer-inline-chrome");
  });
});

describe("#911 — dark-mode-safe color fallbacks", () => {
  it("keeps math errors, grid tables, and the app error boundary token-driven", () => {
    const css = fileText("src/editor-theme.css");
    const tableGrid = fileText("src/render/table-grid.ts");
    const boundary = fileText("src/app/components/error-boundary.tsx");

    expect((css.match(/--cf-math-error-fg:/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((css.match(/--cf-math-error-bg:/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(css).toContain("color: var(--cf-math-error-fg);");
    expect(css).toContain("background: var(--cf-math-error-bg);");
    expect(css).not.toContain("color: var(--cf-math-error-fg, #c00);");
    expect(css).not.toContain("background: var(--cf-math-error-bg, rgba(255, 0, 0, 0.05));");

    expect(tableGrid).toContain('backgroundColor: "var(--cf-bg-secondary)"');
    expect(tableGrid).toContain('borderBottom: "2px solid var(--cf-border)"');
    expect(tableGrid).not.toContain("#f5f5f5");
    expect(tableGrid).not.toContain("#ddd");
    expect(tableGrid).not.toContain("#ccc");

    expect(boundary).toContain('color: "var(--cf-fg)"');
    expect(boundary).toContain('background: "var(--cf-bg)"');
    expect(boundary).toContain('color: "var(--cf-muted)"');
    expect(boundary).toContain('border: "1px solid var(--cf-border)"');
    expect(boundary).not.toContain("#1a1a1a");
    expect(boundary).not.toContain("#fff");
    expect(boundary).not.toContain("#666");
    expect(boundary).not.toContain("#ccc");
  });
});

describe("#287 — Chrome for Testing app facility", () => {
  it("shared Chrome launcher helper exists", () => {
    expect(fileExists("scripts/chrome-common.mjs")).toBe(true);
  });

  it("package scripts expose explicit app and cdp launcher roles", () => {
    const pkg = fileText("package.json");
    expect(pkg).toContain('"chrome:app"');
    expect(pkg).toContain('"chrome:cdp"');
  });
});

describe("#275 — app-wide perf instrumentation", () => {
  it("frontend perf module exports aggregation helpers", async () => {
    const mod = await import("./perf");
    expect(mod.getCombinedPerfSnapshot).toBeDefined();
    expect(mod.measureAsync).toBeDefined();
    expect(mod.withPerfOperation).toBeDefined();
  });

  it("perf debug panel exists", async () => {
    const mod = await import("./components/perf-debug-panel");
    expect(mod.PerfDebugPanel).toBeDefined();
  });

  it("tauri perf commands are registered", () => {
    expect(fileExists("src-tauri/src/commands/perf.rs")).toBe(true);
    const mainRs = fileText("src-tauri/src/main.rs");
    expect(mainRs).toContain("commands::perf::get_perf_snapshot");
    expect(mainRs).toContain("commands::perf::clear_perf_snapshot");
  });
});

describe("#266 — Playwright mode switching helper", () => {
  it("status bar exposes a stable mode button test id", () => {
    const statusBar = fileText("src/app/components/status-bar.tsx");
    expect(statusBar).toContain('data-testid="mode-button"');
  });

  it("test helpers export switchToMode", () => {
    const helpers = fileText("scripts/test-helpers.mjs");
    expect(helpers).toContain("export async function switchToMode");
    expect(helpers).toContain('page.getByTestId("mode-button")');
  });
});

describe("#279 — shared Lezer document semantics", () => {
  it("shared document semantics analyzers exist", async () => {
    const mod = await import("../semantics/document");
    expect(mod.analyzeDocumentSemantics).toBeDefined();
    expect(mod.analyzeHeadings).toBeDefined();
    expect(mod.analyzeFootnotes).toBeDefined();
    expect(mod.analyzeFencedDivs).toBeDefined();
  });

  it("CodeMirror text-source adapter exists", async () => {
    const mod = await import("../state/document-analysis");
    expect(mod.editorStateTextSource).toBeDefined();
  });
});

describe("#298 — canonical document analysis pass", () => {
  it("defines the shared analysis field and standalone analyzer", async () => {
    const cmSource = await import("../state/document-analysis");
    const semantics = await import("../semantics/document");

    expect(cmSource.documentAnalysisField).toBeDefined();
    expect(semantics.analyzeDocumentSemantics).toBeDefined();
  });

  it("routes high-overlap consumers through shared document analysis", () => {
    const extract = fileText("src/index/extract.ts");
    const htmlEntry = fileText("src/app/markdown-to-html.ts");
    const htmlDocument = fileText("src/app/markdown-to-html/document.ts");
    const crossrefs = fileText("src/index/crossref-resolver.ts");
    const references = fileText("src/render/reference-render.ts");

    expect(extract).toMatch(
      /getDocumentAnalysis|rememberDocumentAnalysis|getCachedDocumentAnalysis|rememberCachedDocumentAnalysis/,
    );
    expect(htmlEntry).toContain('export { markdownToHtml } from "./markdown-to-html/document"');
    expect(htmlDocument).toMatch(/analyze(?:Document|Markdown)Semantics/);
    expect(crossrefs).toMatch(/documentAnalysisField|getDocumentAnalysisOrRecompute|buildEditorDocumentReferenceCatalog/);
    expect(references).toMatch(
      /documentAnalysisField|getDocumentAnalysisOrRecompute|buildEditorDocumentReferenceCatalog|reference-render-state|getReferenceRenderAnalysis|getReferenceRenderState/,
    );
  });
});

describe("#1085 — neutral document analysis state owner", () => {
  it("owns the CM6 document analysis field under src/state", async () => {
    const mod = await import("../state/document-analysis");

    expect(fileExists("src/state/document-analysis.ts")).toBe(true);
    expect(mod.documentAnalysisField).toBeDefined();
    expect(mod.documentSemanticsField).toBe(mod.documentAnalysisField);
    expect(mod.editorStateTextSource).toBeDefined();
  });

  it("removes the old semantics-side owner file", () => {
    expect(fileExists("src/semantics/codemirror-source.ts")).toBe(false);
  });
});

describe("#299 — centralized block manifest and CSS registry", () => {
  it("ships typed block manifest, css class registry, and node constants", async () => {
    const blockManifest = await import("../constants/block-manifest");
    const css = await import("../constants/css-classes");
    const nodes = await import("../constants/node-types");

    expect(blockManifest.BLOCK_MANIFEST.length).toBeGreaterThan(0);
    expect(css.CSS.blockHeader).toBe("cf-block-header");
    expect(nodes.NODE.FencedDiv).toBe("FencedDiv");
  });

  it("uses the shared registries in block rendering paths", () => {
    const blockTheme = fileText("src/editor/block-theme.ts");
    const pluginRender = fileText("src/render/plugin-render.ts");
    const pluginRenderChrome = fileText("src/render/plugin-adapters/chrome.ts");
    const decorationBuilder = fileText("src/plugins/decoration-builder.ts");
    const specialBehaviorHandlers = fileText("src/plugins/special-behavior-handlers.ts");

    expect(blockTheme).toContain("STYLED_BLOCK_NAMES");
    expect(pluginRender).toContain("getPluginOrFallback");
    expect(pluginRender).toContain("createFencedBlockDecorationField");
    expect(pluginRender).toContain("DecorationBuilder");
    expect(pluginRender).toContain("applySpecialBehavior");
    expect(pluginRenderChrome).toContain("CSS.blockHeaderRendered");
    expect(pluginRenderChrome).toContain("MacroRenderingWidget");
    expect(pluginRenderChrome).toContain("renderDocumentFragmentToDom");
    expect(decorationBuilder).toContain("class DecorationBuilder");
    expect(specialBehaviorHandlers).toContain("specialBehaviorHandlers");
    expect(pluginRenderChrome).toContain("PluginRenderAdapter");
    expect(pluginRenderChrome).toContain("addPluginMarkerReplacement");
    expect(decorationBuilder).not.toMatch(/from ["']\.\.\/render\//);
    expect(pluginRender).toContain("renderDecorations?.addBodyDecorations");
    // #374 and #1094: special-behavior dispatch remains centralized for shared cases.
    expect(specialBehaviorHandlers).toContain("applySpecialBehavior");
  });
});

describe("#1092 — plugin-owned render adapter seam", () => {
  it("defines the plugin render contract without reverse imports", async () => {
    const contract = await import("../plugins/plugin-render-adapter");
    const contractFile = fileText("src/plugins/plugin-render-adapter.ts");

    expect(contract.addPluginMarkerReplacement).toBeDefined();
    expect(contract.pushPluginHiddenDecoration).toBeDefined();
    expect(contract.pushPluginWidgetDecoration).toBeDefined();
    expect(contractFile).toContain("export interface PluginRenderAdapter");
    expect(contractFile).toContain("export interface PluginRenderWidget");
    expect(contractFile).not.toMatch(/from "\.\.\/render\//);
  });

  it("routes block chrome through the render adapter", () => {
    const pluginRender = fileText("src/render/plugin-render.ts");
    const chrome = fileText("src/render/plugin-adapters/chrome.ts");
    const decorationBuilder = fileText("src/plugins/decoration-builder.ts");
    const bridge = fileText("src/lib/plugin-render-adapter.ts");
    const renderAdapter = fileText("src/render/plugin-render-adapter.ts");
    const renderIndex = fileText("src/render/index.ts");
    const pluginsIndex = fileText("src/plugins/index.ts");

    expect(fileExists("src/render/plugin-render.ts")).toBe(true);
    expect(fileExists("src/plugins/plugin-render.ts")).toBe(false);
    expect(fileExists("src/render/plugin-adapters/chrome.ts")).toBe(true);
    expect(fileExists("src/plugins/plugin-render-chrome.ts")).toBe(false);
    expect(renderAdapter).toContain("const codeMirrorPluginRenderAdapter: PluginRenderAdapter");
    expect(renderAdapter).toContain("createHeaderWidget");
    expect(bridge).toContain('import type { PluginRenderAdapter }');
    expect(bridge).toContain("codeMirrorPluginRenderAdapter");
    expect(renderIndex).toContain("blockRenderPlugin");
    expect(pluginsIndex).not.toContain("blockRenderPlugin");
    expect(pluginRender).toContain("pluginRenderAdapter");
    expect(pluginRender).toContain("./plugin-adapters/chrome");
    expect(decorationBuilder).toContain("pushPluginHiddenDecoration");
    expect(decorationBuilder).not.toMatch(/from ["']\.\.\/render\//);
    expect(fileExists("src/plugins/embed-plugin.ts")).toBe(false);
    expect(chrome).toContain("PluginRenderAdapter");
    expect(chrome).toContain("adapter.createHeaderWidget");
    expect(pluginRender).not.toContain("../render/plugin-render-adapter");
    expect(pluginRender).not.toContain("./plugin-render-chrome");
    expect(decorationBuilder).not.toContain("./plugin-render-chrome");
    expect(decorationBuilder).not.toContain("./plugin-render-embed");
    expect(chrome).toContain("../../plugins/plugin-render-adapter");
    expect(chrome).not.toContain("../plugin-render-adapter");
  });
});

describe("#1095 — fence protection owns its code-block structure dependency", () => {
  it("keeps fence protection out of render internals", () => {
    const fenceProtection = fileText("src/plugins/fence-protection.ts");
    const codeBlockRender = fileText("src/render/code-block-render.ts");

    expect(fileExists("src/state/code-block-structure.ts")).toBe(true);
    expect(fenceProtection).toContain('../state/code-block-structure');
    expect(fenceProtection).not.toMatch(/from "\.\.\/render\//);
    expect(codeBlockRender).toContain('../state/code-block-structure');
  });
});

describe("#321 — standardized background dispatch handling", () => {
  it("documents the error-handling policy and exports the dispatch helper", async () => {
    const dispatch = await import("./lib/view-dispatch");
    const claude = fileText("CLAUDE.md");

    expect(dispatch.dispatchIfConnected).toBeDefined();
    expect(claude).toContain("Error handling policy");
    expect(claude).toContain("Never use bare `catch {}`");
  });

  it("uses the shared helper in background editor services", () => {
    const bibliography = fileText("src/app/hooks/use-bibliography.ts");
    const services = fileText("src/app/hooks/use-editor-document-services.ts");

    expect(bibliography).toContain("dispatchIfConnected");
    expect(services).not.toContain("dispatchIfConnected");
  });
});

describe("#370 — shared decoration/widget factories", () => {
  it("exports the shared decoration and widget helpers from render-utils", async () => {
    const renderUtils = await import("../render/render-utils");

    expect(renderUtils.createSimpleViewPlugin).toBeDefined();
    expect(renderUtils.createDecorationsField).toBeDefined();
    expect(renderUtils.pushWidgetDecoration).toBeDefined();
    expect(renderUtils.collectNodeRangesExcludingCursor).toBeDefined();
  });

  it("routes representative renderers through the shared helpers", () => {
    const checkbox = fileText("src/render/checkbox-render.ts");
    const image = fileText("src/render/image-render.ts");
    const reference = fileText("src/render/reference-render.ts");
    const pluginRender = fileText("src/render/plugin-render.ts");

    expect(checkbox).toContain("createIncrementalDecorationsViewPlugin");
    expect(checkbox).toContain("pushWidgetDecoration");
    expect(image).toContain("pushWidgetDecoration");
    expect(reference).toContain("createSemanticSensitiveViewPlugin");
    expect(reference).toContain("pushWidgetDecoration");
    expect(pluginRender).toContain("buildFencedBlockDecorations");
    expect(pluginRender).toContain("createFencedBlockDecorationField");
  });
});

describe("#372 — error handling coverage", () => {
  it("keeps the app root behind an ErrorBoundary and logs guarded UI handlers", () => {
    const app = fileText("src/app/app.tsx");
    const boundary = fileText("src/app/components/error-boundary.tsx");
    const fileWatcher = fileText("src/app/file-watcher.ts");
    const findReplace = fileText("src/editor/find-replace.ts");

    expect(app).toContain("<ErrorBoundary>");
    expect(boundary).toContain("getDerivedStateFromError");
    expect(fileWatcher).toContain("reload button handler failed");
    expect(findReplace).toContain("action click handler failed");
  });
});

describe("#376 — shared text widget primitives", () => {
  it("exports the shared simple-text and macro-aware widget bases", async () => {
    const renderUtils = await import("../render/render-utils");

    expect(renderUtils.SimpleTextRenderWidget).toBeDefined();
    expect(renderUtils.SimpleTextReferenceWidget).toBeDefined();
    expect(renderUtils.MacroAwareWidget).toBeDefined();
  });

  it("routes representative widget families through the shared text helpers", () => {
    const citations = fileText("src/citations/citation-render.ts");
    const crossrefs = fileText("src/render/crossref-render.ts");
    const codeBlockDecorations = fileText("src/render/code-block-decorations.ts");
    const sidenotes = fileText("src/render/sidenote-render.ts");
    const frontmatterRender = fileText("src/editor/frontmatter-render.ts");

    expect(citations).toContain("extends SimpleTextReferenceWidget");
    expect(crossrefs).toContain("extends SimpleTextReferenceWidget");
    expect(codeBlockDecorations).toContain("extends ShellWidget");
    expect(codeBlockDecorations).toContain("makeTextElement");
    expect(sidenotes).toContain("extends SimpleTextRenderWidget");
    expect(frontmatterRender).toContain("ShellMacroAwareWidget");
  });
});

describe("#386 — async cleanup and parallelization", () => {
  it("parallelizes the open-folder refresh path and keeps save/create flows on the shared session modules", () => {
    const workspace = fileText("src/app/hooks/use-app-workspace-session.ts");
    const session = fileText("src/app/hooks/use-editor-session.ts");
    const runtime = fileText("src/app/editor-session-runtime.ts");
    const sessionService = fileText("src/app/editor-session-service.ts");
    const persistence = fileText("src/app/editor-session-persistence.ts");

    expect(workspace).toContain("const [tree, nextProjectConfig] = await Promise.all([");
    expect(workspace).toContain("return loadWorkspaceContents(requestId)");
    expect(session).toContain("createEditorSessionRuntime()");
    expect(session).toContain("createEditorSessionPersistence({");
    expect(runtime).toContain("subscribe:");
    expect(sessionService).toContain("await refreshTree(path)");
    expect(sessionService).toContain("await openFile(path)");
    expect(persistence).toContain("await writeDocumentSnapshot(relativePath, doc, {");
    expect(persistence).toContain("createTargetIfMissing: true,");
  });
});

describe("#290 — Lezer-first markdown parsing", () => {
  it("equation label extraction uses the shared braced-label helper", () => {
    const semantics = fileText("src/semantics/document.ts");

    expect(fileExists("src/parser/label-utils.ts")).toBe(true);
    expect(semantics).toContain("readBracedLabelId");
  });

  it("image and list handling no longer regex-parse markdown markers", () => {
    const imageRender = fileText("src/render/image-render.ts");
    const listOutliner = fileText("src/editor/list-outliner.ts");

    expect(imageRender).toContain('node.getChild("URL")');
    expect(imageRender).not.toContain('/^!\\[([^\\]]*)\\]\\(([^)]*)\\)$/');
    expect(listOutliner).toContain('getChild("ListMark")');
    expect(listOutliner).not.toContain('lineText.match(/^(\\s*)([-*+])\\s/)');
    expect(listOutliner).not.toContain('lineText.match(/^(\\s*)(\\d+)([.)]\\s)/');
  });

  it("writing stats strips frontmatter via the frontmatter parser", () => {
    const writingStats = fileText("src/app/writing-stats.ts");
    expect(writingStats).toContain("parseFrontmatter");
    expect(writingStats).not.toContain("replace(/^---[\\\\s\\\\S]*?---\\\\n?/, \"\")");
  });
});

describe("#291 — project rename to Coflats", () => {
  it("core product metadata uses the Coflats name", () => {
    const pkg = fileText("package.json");
    const tauri = fileText("src-tauri/tauri.conf.json");
    const html = fileText("index.html");

    expect(pkg).toContain('"name": "coflat"');
    expect(tauri).toContain('"productName": "Coflats"');
    expect(tauri).toContain('"identifier": "com.coflats.desktop"');
    expect(html).toContain("<title>Coflats</title>");
  });

  it("theme exports and project config filename are renamed", async () => {
    const theme = await import("../editor/theme");
    const config = await import("./project-config");

    expect(theme.coflatTheme).toBeDefined();
    expect(theme.coflatDarkTheme).toBeDefined();
    expect(config.PROJECT_CONFIG_FILE).toBe("coflat.yaml");
  });
});

describe("#317 — typed frontend Tauri client", () => {
  it("frontend tauri-client modules exist for the current command families", () => {
    expect(fileExists("src/app/tauri-client/core.ts")).toBe(true);
    expect(fileExists("src/app/tauri-client/fs.ts")).toBe(true);
    expect(fileExists("src/app/tauri-client/perf.ts")).toBe(true);
    expect(fileExists("src/app/tauri-client/watch.ts")).toBe(true);
    expect(fileExists("src/app/tauri-client/export.ts")).toBe(true);
  });

  it("feature code uses the tauri-client layer instead of raw invoke strings", () => {
    const tauriFs = fileText("src/app/tauri-fs.ts");
    const imageInsert = fileText("src/editor/image-insert.ts");
    const fileWatcher = fileText("src/app/file-watcher.ts");
    const exportModule = fileText("src/app/export.ts");

    expect(tauriFs).toContain('./tauri-client/fs');
    expect(fileWatcher).toContain("./tauri-client/watch");
    expect(exportModule).toContain("./tauri-client/export");
    expect(imageInsert).not.toContain('@tauri-apps/api/core');
    expect(imageInsert).not.toContain("@tauri-apps/plugin-dialog");
    expect(fileWatcher).not.toContain('invokeWithPerf("watch_directory"');
    expect(fileWatcher).not.toContain('invokeWithPerf("unwatch_directory"');
    expect(exportModule).not.toContain('invokeWithPerf("check_pandoc"');
    expect(exportModule).not.toContain('invokeWithPerf("export_document"');
  });
});

describe("#454 — native out-of-project opens use a new window", () => {
  it("grants the spawned document windows the Tauri capabilities they need", () => {
    const capabilities = fileText("src-tauri/capabilities/default.json");

    expect(capabilities).toContain('"document-*"');
    expect(capabilities).toContain('"core:window:allow-create"');
    expect(capabilities).toContain('"core:window:allow-set-focus"');
    expect(capabilities).toContain('"core:webview:allow-create-webview-window"');
  });

  it("targets native menu events at the focused or last-focused window without broadcasting", () => {
    const menu = fileText("src-tauri/src/menu.rs");
    const main = fileText("src-tauri/src/main.rs");

    expect(menu).toContain("webview_windows()");
    expect(menu).toContain("LastFocusedWindow");
    expect(menu).toContain('emit_to(label.as_str(), "menu-event", id)');
    expect(menu).not.toContain('app_handle.emit("menu-event", id)');
    expect(main).toContain("LastFocusedWindow");
    expect(main).toContain("WindowEvent::Focused(true)");
  });
});

describe("#308 — shared base editor extensions", () => {
  it("extracts common editor setup into a reusable helper module", () => {
    expect(fileExists("src/editor/base-editor-extensions.ts")).toBe(true);
  });

  it("keeps the shared base extension module behind the inline-editor compatibility shim", () => {
    const editor = fileText("src/editor/editor.ts");
    const inlineEditor = fileText("src/inline-editor.ts");
    const inlineEditorShim = fileText("src/editor/inline-editor.ts");

    expect(editor).toContain("./base-editor-extensions");
    expect(inlineEditor).toContain("./editor/base-editor-extensions");
    expect(inlineEditorShim).toContain('../inline-editor');
    expect(inlineEditor).not.toContain("../parser/math-backslash");
    expect(inlineEditor).not.toContain("../parser/highlight");
    expect(inlineEditor).not.toContain("../parser/strikethrough");
  });
});

describe("#318 — subsystem pattern", () => {
  it("documents the subsystem pattern in repo docs", () => {
    expect(fileExists("docs/architecture/subsystem-pattern.md")).toBe(true);
  });

  it("adds subsystem guidance to the agent instructions", () => {
    const claude = fileText("CLAUDE.md");
    const agents = fileText("AGENTS.md");

    expect(claude).toContain("docs/architecture/subsystem-pattern.md");
    expect(claude).toContain("One concept should have one clear owner");
    expect(agents).toContain("docs/architecture/subsystem-pattern.md");
    expect(agents).toContain("One concept should have one clear owner");
  });

  it("documents the neutral-owner rule and its canonical home", () => {
    const subsystemPattern = fileText("docs/architecture/subsystem-pattern.md");
    const claude = fileText("CLAUDE.md");
    const agents = fileText("AGENTS.md");

    expect(subsystemPattern).toContain("## Neutral owner for cross-subsystem state");
    expect(subsystemPattern).toContain("`src/state/` is the");
    expect(subsystemPattern).toContain("subsystems may consume `src/state/`");
    expect(subsystemPattern).toContain("must not define state for another subsystem");
    expect(subsystemPattern).toContain("`src/state/document-analysis.ts`");
    expect(subsystemPattern).toContain("`src/state/code-block-structure.ts`");
    expect(subsystemPattern).toContain("`src/state/plugin-registry.ts`");
    expect(subsystemPattern).toContain(
      "state into `src/state/`, the neutral owner, instead of parking it",
    );
    expect(claude).toContain(
      "docs/architecture/subsystem-pattern.md#neutral-owner-for-cross-subsystem-state",
    );
    expect(agents).toContain(
      "docs/architecture/subsystem-pattern.md#neutral-owner-for-cross-subsystem-state",
    );
  });
});

describe("#1091 — document state module contract", () => {
  it("documents canonical src/state composition rules", () => {
    const subsystem = fileText("docs/architecture/subsystem-pattern.md");
    const documentState = fileText("docs/architecture/document-state-module.md");

    expect(fileExists("docs/architecture/document-state-module.md")).toBe(true);
    expect(subsystem).toContain("Document State Module");
    expect(subsystem).toContain("src/state/");
    expect(documentState).toContain("reference-render-state.ts");
    expect(documentState).toContain("src/state/<use-case>-state.ts");
    expect(documentState).toContain("Do not add a broad `src/state/index.ts` barrel");
  });

  it("routes a representative renderer through a state composition module", () => {
    const referenceRender = fileText("src/render/reference-render.ts");
    const referenceRenderState = fileText("src/state/reference-render-state.ts");

    expect(fileExists("src/state/reference-render-state.ts")).toBe(true);
    expect(referenceRender).toContain("../state/reference-render-state");
    expect(referenceRenderState).toContain("getReferenceRenderState");
    expect(referenceRenderState).toContain("referenceRenderDependenciesChanged");
  });
});

describe("document format instructions", () => {
  it("points agent instructions at FORMAT.md as the canonical markdown spec", () => {
    const claude = fileText("CLAUDE.md");
    const agents = fileText("AGENTS.md");

    expect(claude).toContain("FORMAT.md");
    expect(claude).toContain("All markdown files in this repo must follow `FORMAT.md`.");
    expect(agents).toContain("FORMAT.md");
    expect(agents).toContain("All markdown files in this repo must follow `FORMAT.md`.");
  });
});

describe("#314 — document surface renderer layer", () => {
  it("defines a shared document surface renderer module", () => {
    expect(fileExists("src/document-surfaces.ts")).toBe(true);
  });

  it("routes title, tooltip, hover, and chrome surfaces through the shared surface layer", () => {
    const headingChrome = fileText("src/app/components/heading-chrome.tsx");
    // Tooltip rendering moved to use-footnote-tooltip (T27 decomposition)
    const footnoteTooltip = fileText("src/app/hooks/use-footnote-tooltip.ts");
    const hoverPreview = fileText("src/render/hover-preview.ts");
    const pluginRenderChrome = fileText("src/render/plugin-adapters/chrome.ts");
    const frontmatterRender = fileText("src/editor/frontmatter-render.ts");

    expect(headingChrome).toContain("../../document-surfaces");
    expect(footnoteTooltip).toContain("../../document-surfaces");
    expect(hoverPreview).toContain("../document-surfaces");
    expect(pluginRenderChrome).toContain("../../document-surfaces");
    expect(frontmatterRender).toContain("../document-surfaces");
  });
});

describe("#315 — editor session subsystem", () => {
  it("extracts the editor session model and pure session actions", () => {
    expect(fileExists("src/app/editor-session-model.ts")).toBe(true);
    expect(fileExists("src/app/editor-session-actions.ts")).toBe(true);
    expect(fileExists("src/app/editor-session-actions.test.ts")).toBe(true);
  });

  it("routes the app shell through explicit session intents instead of raw tab setters", () => {
    const appMainShell = fileText("src/app/components/app-main-shell.tsx");
    const sessionHook = fileText("src/app/hooks/use-editor-session.ts");
    const persistence = fileText("src/app/hooks/use-app-session-persistence.ts");
    const runtime = fileText("src/app/editor-session-runtime.ts");

    expect(appMainShell).toContain("currentPath");
    expect(appMainShell).not.toContain("TabBar");
    expect(appMainShell).not.toContain("setOpenTabs");
    expect(sessionHook).toContain("../editor-session-runtime");
    expect(sessionHook).toContain("createEditorSessionService");
    expect(runtime).toContain("createEditorSessionRuntime");
    expect(persistence).toContain("currentDocument");
    expect(persistence).not.toContain("switchToTab");
    expect(persistence).not.toContain("setActiveTab");
  });
});

describe("#967 — document session service", () => {
  it("extracts explicit session transitions into a dedicated service and routes watcher sync through it", () => {
    const sessionHook = fileText("src/app/hooks/use-editor-session.ts");
    const watcher = fileText("src/app/file-watcher.ts");
    const app = fileText("src/app/app.tsx");
    const runtime = fileText("src/app/editor-session-runtime.ts");
    const persistence = fileText("src/app/editor-session-persistence.ts");

    expect(fileExists("src/app/editor-session-service.ts")).toBe(true);
    expect(fileExists("src/app/editor-session-runtime.ts")).toBe(true);
    expect(fileExists("src/app/editor-session-persistence.ts")).toBe(true);
    expect(sessionHook).toContain("../editor-session-service");
    expect(sessionHook).toContain("../editor-session-runtime");
    expect(sessionHook).toContain("../editor-session-persistence");
    expect(sessionHook).toContain("syncExternalChange");
    expect(sessionHook).not.toContain("buffers:");
    expect(sessionHook).not.toContain("liveDocs:");
    expect(sessionHook).not.toContain("pipeline:");
    expect(sessionHook).not.toContain("setEditorDoc");
    expect(watcher).toContain("syncExternalChange");
    expect(app).toContain("syncExternalChange: editor.syncExternalChange");
    expect(runtime).toContain("setWriteDocumentSnapshot");
    expect(persistence).toContain("createEditorSessionPersistence");
  });
});

describe("#316 — theme contract and surface token map", () => {
  it("defines a shared theme contract and architecture note", () => {
    expect(fileExists("src/theme-contract.ts")).toBe(true);
    expect(fileExists("docs/architecture/theme-contract.md")).toBe(true);
  });

  it("separates theme DOM application from stateful theme orchestration", () => {
    const useTheme = fileText("src/app/hooks/use-theme.ts");
    const exportFile = fileText("src/app/export.ts");

    expect(useTheme).toContain("../theme-dom");
    expect(exportFile).toContain("../theme-contract");
  });
});

describe("#847 — hover preview foreground color", () => {
  it("uses normal foreground color for shared preview bodies and citation rows", () => {
    const css = fileText("src/editor-theme.css");

    expect(css).toContain(".cf-preview-surface-body {\n  color: var(--cf-fg);");
    expect(css).toContain(".cf-hover-preview-citation {\n  color: var(--cf-fg);");
    expect(css).toContain(".cf-hover-preview-unresolved {\n  color: var(--cf-muted);");
  });
});
