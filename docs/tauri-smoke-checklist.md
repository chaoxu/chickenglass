# Tauri Smoke Verification Checklist

Manual checklist for verifying native app-action wiring in the Tauri desktop build.
Run this checklist after any change to menu events, command palette entries, keyboard
shortcuts, or the Tauri menu definition (`src-tauri/src/menu.rs`).

## Prerequisites

1. Build and launch the Tauri app:

   ```bash
   npm run tauri:dev
   ```

2. The app should start with the demo blog project loaded.
3. Open the DevTools console (View > Toggle Debug or Cmd+Shift+D) to watch for
   runtime errors during testing.

---

## 1. Open File (menu + Cmd+O)

| Step | Action | Expected Result | How to Verify |
|------|--------|-----------------|---------------|
| 1a | Click **File > Open File** in the native menu bar | A native file picker dialog appears | Dialog is visible and responds to interaction |
| 1b | Select a `.md` file and confirm | The selected file opens in the editor | File content is displayed; filename appears in the tab bar |
| 1c | Press **Cmd+O** | The same native file picker dialog appears | Dialog is visible (same behavior as menu) |
| 1d | Cancel the file picker without selecting a file | No error; editor state unchanged | No console errors; previous file still displayed |

## 2. Open Folder (menu + Cmd+Shift+O)

| Step | Action | Expected Result | How to Verify |
|------|--------|-----------------|---------------|
| 2a | Click **File > Open Folder** in the native menu bar | A native folder picker dialog appears | Dialog is visible and responds to interaction |
| 2b | Select a folder containing `.md` files and confirm | The sidebar file tree updates to show the selected folder's contents | File tree in sidebar reflects the chosen folder; first file may auto-open |
| 2c | Press **Cmd+Shift+O** | The same native folder picker dialog appears | Dialog is visible (same behavior as menu) |
| 2d | Open a folder, then open a different folder | The file tree switches to the new folder | Previous folder's files are gone; new folder's files are listed |

## 3. Export HTML (menu + Cmd+Shift+E)

| Step | Action | Expected Result | How to Verify |
|------|--------|-----------------|---------------|
| 3a | Open a `.md` file with content (headings, math, fenced divs) | File loads in the editor | Content is displayed |
| 3b | Click **File > Export...** in the native menu bar | An export dialog or save dialog appears | Dialog is visible |
| 3c | Choose HTML export and confirm | An `.html` file is written next to the source file | Check the filesystem for the output file; open it in a browser to confirm valid HTML with rendered math |
| 3d | Press **Cmd+Shift+E** | Same export flow as the menu action | Export completes without error |
| 3e | Open the exported HTML in a browser | Self-contained HTML with KaTeX math, headings, fenced div blocks | Visual inspection: math renders, structure matches source |

## 4. Quit with Dirty-File Confirmation (Cmd+Q)

| Step | Action | Expected Result | How to Verify |
|------|--------|-----------------|---------------|
| 4a | Open a file and make an edit (type a character) | The file is marked as dirty/unsaved | Tab shows unsaved indicator (dot or modified marker) |
| 4b | Press **Cmd+Q** or click **File > Quit** | A confirmation dialog appears asking to save/discard/cancel | Dialog is visible with save/discard/cancel options |
| 4c | Click **Cancel** in the confirmation dialog | The app stays open; edit is preserved | App window remains; typed content still present |
| 4d | Press **Cmd+Q** again and click **Save** | The file is saved and the app quits | App closes; re-open and verify the edit was persisted |
| 4e | Make another edit, press **Cmd+Q**, and click **Discard** | The app quits without saving | App closes; re-open and verify the edit was NOT persisted |
| 4f | Save the file (Cmd+S), then press **Cmd+Q** | The app quits immediately (no confirmation) | App closes without a dialog since there are no unsaved changes |

## 5. Keyboard Shortcuts Dialog (menu + Cmd+/)

| Step | Action | Expected Result | How to Verify |
|------|--------|-----------------|---------------|
| 5a | Click **Help > Keyboard Shortcuts** in the native menu bar | The Keyboard Shortcuts dialog opens | Dialog is visible with categorized shortcut list |
| 5b | Press **Cmd+/** | Same dialog opens | Dialog appears (same as menu) |
| 5c | Type a filter query (e.g., "bold") | The shortcut list filters to matching entries | Only shortcuts containing "bold" are shown |
| 5d | Press **Escape** | The dialog closes | Dialog disappears; editor is focused |
| 5e | Verify shortcut categories | File, Edit, View, Navigation, and Format categories are present | Scroll through the dialog and confirm all categories |

## 6. Command Palette (Cmd+P)

| Step | Action | Expected Result | How to Verify |
|------|--------|-----------------|---------------|
| 6a | Press **Cmd+P** (or click the command icon in the status bar) | The command palette opens | A searchable command list overlay appears |
| 6b | Verify command entries include at least: Save File, Open Folder, Export HTML, Keyboard Shortcuts, Toggle Sidebar | All listed commands appear in the palette | Scroll or search for each command |
| 6c | Type "save" and select "Save File" | The active file is saved | File saved indicator updates; no console errors |
| 6d | Type "export" and select "Export Current File to HTML" | The export flow starts (same as menu) | Export dialog or file write proceeds |
| 6e | Type "shortcut" and select "Keyboard Shortcuts" | The shortcuts dialog opens | Dialog appears |
| 6f | Press **Escape** to dismiss the palette | Palette closes without side effects | Palette disappears; editor is focused |
| 6g | Cross-check: every native menu item with a wired handler has a corresponding palette entry | No menu actions are missing from the palette | Compare File/Edit/View/Format/Help menu items against palette commands |

## 7. Mode Switching (Rich/Source)

| Step | Action | Expected Result | How to Verify |
|------|--------|-----------------|---------------|
| 7a | Open a `.md` file; check the status bar (bottom-right) | Mode indicator shows "Rich" (default for markdown) | Status bar displays "Rich" |
| 7b | Click the mode indicator in the status bar | Mode cycles to "Source" | Status bar now shows "Source"; editor shows raw markdown |
| 7c | Click the mode indicator again | Mode cycles back to "Rich" | Status bar shows "Rich"; editor shows rendered content |
| 7d | Open a non-markdown file (e.g., `.yaml`, `.json`) | Mode indicator shows "Source" and is disabled | Status bar shows "Source"; clicking does nothing |
| 7e | Use the command palette: search "mode" or "Rich" | No direct mode-switch command exists (mode is toggled via status bar) | Confirm behavior matches expectations |

## 8. Recent Files (menu)

| Step | Action | Expected Result | How to Verify |
|------|--------|-----------------|---------------|
| 8a | Open several different files via Open File or the sidebar | Each file is tracked in the recent files list | Proceed to step 8b |
| 8b | Open the command palette (Cmd+P) and type "recent" | "Open Recent: <filename>" entries appear for previously opened files | Recently opened filenames are listed |
| 8c | Select a recent file entry | That file opens in the editor | File content appears; tab updates to the selected file |

## 9. Save (Cmd+S)

| Step | Action | Expected Result | How to Verify |
|------|--------|-----------------|---------------|
| 9a | Open a file and make an edit | File is marked dirty | Tab shows unsaved indicator |
| 9b | Press **Cmd+S** | File is saved | Unsaved indicator disappears; no console errors |
| 9c | Click **File > Save** in the native menu bar | File is saved (same as Cmd+S) | Unsaved indicator disappears |
| 9d | Press **Cmd+Shift+S** (Save As) | A native save dialog appears | Dialog lets you choose a new filename/location |
| 9e | Save to a new location via Save As | A new file is created at the chosen path | New file exists on disk with the correct content |

---

## Wiring Cross-Reference

This table maps native menu IDs (from `src-tauri/src/menu.rs`) to their frontend
handler (from `src/app/hooks/use-menu-events.ts`) and command palette entry (from
`src/app/hooks/use-commands.ts`).

| Menu ID | Menu Label | Menu Handler | Palette Command | Palette ID |
|---------|-----------|-------------|----------------|------------|
| `file_new` | New | (not yet wired) | -- | -- |
| `file_open_file` | Open File | (not yet wired) | -- | -- |
| `file_open_folder` | Open Folder | `onOpenFolder` | Open Folder... | `file.open-folder` |
| `file_save` | Save | `onSave` | Save File | `file.save` |
| `file_save_as` | Save As | `onSaveAs` | Save As... | `file.save-as` |
| `file_export` | Export... | `onExport` | Export Current File to HTML | `export.html` |
| `file_close_tab` | Close Tab | `onCloseTab` | Close Tab | `file.close-tab` |
| `file_quit` | Quit | (native Tauri) | -- | -- |
| `edit_find` | Find | `onShowSearch` | Find in Files | `nav.search` |
| `view_toggle_sidebar` | Toggle Sidebar | `onToggleSidebar` | Toggle Sidebar | `view.toggle-sidebar` |
| `help_about` | About Coflat | `onAbout` | About Coflat | `help.about` |
| `help_shortcuts` | Keyboard Shortcuts | `onShowShortcuts` | Keyboard Shortcuts | `help.shortcuts` |
| `format_bold` | Bold | `dispatchFormatEvent("bold")` | Toggle Bold | `format.bold` |
| `format_italic` | Italic | `dispatchFormatEvent("italic")` | Toggle Italic | `format.italic` |
| `format_code` | Code | `dispatchFormatEvent("code")` | -- | -- |
| `format_strikethrough` | Strikethrough | `dispatchFormatEvent("strikethrough")` | -- | -- |
| `format_highlight` | Highlight | `dispatchFormatEvent("highlight")` | -- | -- |
| `format_link` | Link | `dispatchFormatEvent("link")` | -- | -- |

### Known Gaps

These menu items are defined in Rust but have no frontend handler wired in
`use-menu-events.ts` yet:

- `file_new` -- New file creation
- `file_open_file` -- Open File dialog (Cmd+O accelerator exists but handler is not wired through the menu event bridge)
- `file_quit` -- Quit is handled natively by Tauri; dirty-file confirmation is handled via the `beforeunload` / Tauri close-requested event, not the menu event bridge
- `view_zoom_in` / `view_zoom_out` -- Zoom controls
- `view_focus_mode` -- Focus mode toggle
- `view_debug` -- Debug inspector toggle
- `edit_replace` -- Find and Replace

---

## Automation Notes

Automated native testing via Tauri's WebView CDP bridge is a future enhancement.
The approach would be:

1. Launch the Tauri app in dev mode (`npm run tauri:dev`).
2. Connect to the WebView via CDP (Tauri v2 exposes a debug port when built in dev mode).
3. Use `page.evaluate()` to invoke `__app` and `__cmDebug` helpers for non-native actions.
4. Native dialogs (file picker, folder picker) cannot be driven via CDP and require
   OS-level automation (e.g., AppleScript on macOS) or must remain manual.

A `scripts/tauri-smoke.mjs` script is not included because the native dialog
interactions that are most critical to verify (Open File, Open Folder, Quit
confirmation) cannot be reliably automated through CDP alone. The manual checklist
above is the recommended verification path.
