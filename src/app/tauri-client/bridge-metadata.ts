import type { SimpleFormatEventType } from "../../constants/events";

export const TAURI_MENU_EVENT_CHANNEL = "menu-event";

export const TAURI_COMMANDS = {
  openFolder: "open_folder",
  revealInFinder: "reveal_in_finder",
  listTree: "list_tree",
  listChildren: "list_children",
  readFile: "read_file",
  writeFile: "write_file",
  createFile: "create_file",
  fileExists: "file_exists",
  renameFile: "rename_file",
  createDirectory: "create_directory",
  deleteFile: "delete_file",
  writeFileBinary: "write_file_binary",
  readFileBinary: "read_file_binary",
  toProjectRelativePath: "to_project_relative_path",
  watchDirectory: "watch_directory",
  unwatchDirectory: "unwatch_directory",
  debugListWindows: "debug_list_windows",
  debugGetNativeState: "debug_get_native_state",
  debugEmitFileChanged: "debug_emit_file_changed",
} as const;

export const TAURI_MENU_IDS = {
  fileNew: "file_new",
  fileOpenFile: "file_open_file",
  fileOpenFolder: "file_open_folder",
  fileSave: "file_save",
  fileSaveAs: "file_save_as",
  fileExport: "file_export",
  fileCloseTab: "file_close_tab",
  fileQuit: "file_quit",
  editFind: "edit_find",
  editReplace: "edit_replace",
  viewToggleSidebar: "view_toggle_sidebar",
  viewZoomIn: "view_zoom_in",
  viewZoomOut: "view_zoom_out",
  viewFocusMode: "view_focus_mode",
  viewDebug: "view_debug",
  formatBold: "format_bold",
  formatItalic: "format_italic",
  formatCode: "format_code",
  formatStrikethrough: "format_strikethrough",
  formatHighlight: "format_highlight",
  formatLink: "format_link",
  helpAbout: "help_about",
  helpShortcuts: "help_shortcuts",
} as const;

export const TAURI_FORMAT_MENU_EVENT_TYPES: Readonly<Record<string, SimpleFormatEventType>> = {
  [TAURI_MENU_IDS.formatBold]: "bold",
  [TAURI_MENU_IDS.formatItalic]: "italic",
  [TAURI_MENU_IDS.formatCode]: "code",
  [TAURI_MENU_IDS.formatStrikethrough]: "strikethrough",
  [TAURI_MENU_IDS.formatHighlight]: "highlight",
  [TAURI_MENU_IDS.formatLink]: "link",
};
