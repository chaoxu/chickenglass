# React + shadcn/ui Migration Design

## Summary

Rewrite `src/app/` from vanilla TypeScript DOM manipulation to React + shadcn/ui + Tailwind CSS. The CM6 editor engine (`src/editor/`, `src/parser/`, `src/plugins/`, `src/render/`, `src/citations/`, `src/index/`) is completely untouched. The Rust/Tauri backend is untouched.

## Architecture

```
src/
  app/
    components/
      ui/               # shadcn primitives (Dialog, Button, Tabs, etc.)
      sidebar.tsx        # File tree + outline + theme switcher
      tab-bar.tsx        # Open file tabs with drag reorder
      file-tree.tsx      # File tree with context menus
      outline.tsx        # Document outline
      editor-pane.tsx    # div ref where CM6 mounts
      status-bar.tsx     # Word count, cursor pos, editor mode
      breadcrumbs.tsx    # Scroll-following heading path
      settings-dialog.tsx
      command-palette.tsx
      search-panel.tsx
      shortcuts-dialog.tsx
      about-dialog.tsx
      goto-line-dialog.tsx
      context-menu-items.tsx
      symbol-panel.tsx
      split-pane.tsx
    hooks/
      use-editor.ts      # CM6 bridge: mounts view, exposes reactive state
      use-settings.ts    # localStorage-backed settings with defaults
      use-theme.ts       # Light/Dark/System, sets data-theme on html
      use-auto-save.ts   # Timer + blur/tab-switch triggers
      use-hotkeys.ts     # App-level keyboard shortcuts
      use-window-state.ts # Persist/restore tabs, sidebar, active file
      use-recent-files.ts # Track last 10 files, 5 folders
      use-file-system.ts  # Wraps FileSystem interface for React
    lib/
      cn.ts              # clsx + tailwind-merge utility
      types.ts           # Shared types (Tab, Settings, etc.)
    app.tsx              # Root layout component
    main.tsx             # Entry point: ReactDOM.createRoot
  editor/               # UNTOUCHED
  parser/               # UNTOUCHED
  plugins/              # UNTOUCHED
  render/               # UNTOUCHED
  citations/            # UNTOUCHED
  index/                # UNTOUCHED
  globals.css           # CSS variables, dark theme, CM6 overrides
```

## CM6 Bridge: useEditor Hook

```tsx
interface UseEditorOptions {
  doc: string;
  projectConfig: ProjectConfig;
  theme: "light" | "dark";
  extensions?: Extension[];
  onDocChange?: (content: string) => void;
  onCursorChange?: (pos: { line: number; col: number }) => void;
  onFrontmatterChange?: (fm: FrontmatterState | null) => void;
}

interface UseEditorReturn {
  view: EditorView | null;
  wordCount: number;
  cursorPos: { line: number; col: number };
}

function useEditor(
  containerRef: RefObject<HTMLDivElement>,
  options: UseEditorOptions,
): UseEditorReturn;
```

- On mount: calls existing `createEditor()` into the ref container
- CM6 pushes updates to React via `updateListener` callbacks
- On `doc` change: destroys old view, creates new (same as current `switchEditor`)
- On `theme` change: dispatches `themeCompartment.reconfigure()` without recreating
- On unmount: `view.destroy()`
- No other React component imports from `@codemirror/*`

## State Ownership

- **React owns**: open tabs, active file, dirty state, settings, theme, sidebar collapsed, recent files
- **CM6 owns**: document content, cursor, selections, undo history, syntax tree
- **FileSystem**: unchanged interface, called directly by React components

## Data Flow

```
User Action → React Component → State Update → Re-render
                                      ↓
                                useEditor detects prop change
                                      ↓
                              CM6 view recreated/updated
                                      ↓
                              CM6 updateListener fires
                                      ↓
                              React state updated (word count, cursor, etc.)
```

## Styling

- **Tailwind CSS**: all component styling via utility classes
- **shadcn/ui**: pre-built accessible components (Dialog, Tabs, Command, etc.)
- **globals.css**: ~50 lines — CSS custom properties for `--cg-*` tokens, `[data-theme="dark"]` overrides, minimal CM6 theme bridge
- **CM6 theme**: stays in `src/editor/theme.ts`, references `--cg-*` variables

## Component → shadcn Mapping

| Component | shadcn primitives | Notes |
|-----------|------------------|-------|
| TabBar | custom + ContextMenu | Drag-reorder via HTML5 DnD |
| Sidebar | Collapsible, ScrollArea | Cmd+B toggle |
| FileTree | custom tree + ContextMenu | Rename inline, new file/folder |
| StatusBar | Popover | Click word count → stats popup |
| SettingsDialog | Dialog, Tabs, Switch, Select, Slider | Categories: General, Editor, Appearance, Export |
| CommandPalette | Command (cmdk) | Cmd+P, dynamic heading commands |
| SearchPanel | Command | Cmd+Shift+F, results from indexer |
| ShortcutsDialog | Dialog, Table | Cmd+/, searchable |
| AboutDialog | Dialog | Version, credits, links |
| GotoLineDialog | Dialog, Input | Cmd+G, line:column |
| SymbolPanel | ScrollArea, Input, Tooltip | Math symbol grid with search |
| SplitPane | ResizablePanelGroup | Vertical/horizontal split |
| Breadcrumbs | custom | Scroll-following, transparent overlay |

## Migration Phases

### Phase 1: Setup
- Install react, react-dom, tailwindcss, shadcn/ui, @types/react
- Configure Vite for JSX/TSX
- Create globals.css with CSS variables
- Initialize shadcn with `npx shadcn@latest init`
- Create main.tsx React entry point
- Create cn.ts utility

### Phase 2: Core Shell
- useEditor hook (CM6 bridge)
- useTheme hook
- useSettings hook
- App layout (sidebar + editor + status bar)
- EditorPane (ref container for CM6)
- TabBar (open/close/switch/reorder tabs)
- Sidebar (file tree + outline, collapsible)
- FileTree (with rename, delete, new file/folder, context menu)

### Phase 3: Features
- StatusBar + WritingStats popup
- CommandPalette (cmdk)
- SearchPanel
- Breadcrumbs
- SettingsDialog
- All small dialogs (About, Shortcuts, GotoLine)
- ContextMenus (editor, file tree, tab)
- SymbolPanel
- SplitPane
- Auto-save, drag-drop, image paste, window state, recent files

### Phase 4: Cleanup
- Delete all vanilla app files (28 files)
- Rewrite app tests as React Testing Library tests
- Remove old index.html inline styles
- Update barrel exports

## Files Deleted (28 files, ~7,400 lines)
```
app.ts, app-keybindings.ts, app-export.ts, tab-bar.ts, sidebar.ts,
file-tree.ts, outline.ts, status-bar.ts, writing-stats.ts,
breadcrumbs.ts, settings.ts, command-palette.ts, search-panel.ts,
shortcuts-dialog.ts, about-dialog.ts, goto-line.ts, context-menu.ts,
symbol-panel.ts, split-pane.ts, theme-manager.ts, auto-save.ts,
drag-drop.ts, window-state.ts, recent-files.ts, save-dialog.ts,
app-keybindings.ts, app-export.ts, index.ts (barrel, rewritten)
```

## Files Untouched
```
src/editor/*  src/parser/*  src/plugins/*  src/render/*
src/citations/*  src/index/*
src/app/file-manager.ts, tauri-fs.ts, export.ts,
project-config.ts, source-map.ts, file-watcher.ts
src-tauri/* (entire Rust backend)
```

## Estimated Output
- ~2,500 lines of React components (vs 7,400 lines vanilla)
- ~200 lines of hooks
- ~50 lines globals.css (vs 490 lines index.html styles)
- 698+ engine tests remain untouched
