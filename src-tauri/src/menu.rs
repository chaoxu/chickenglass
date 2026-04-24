use crate::commands::state::LastFocusedWindow;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{App, AppHandle, Emitter, Manager, Wry};

/// Build the application menu bar with File, Edit, View, Format, and Help menus.
pub fn build_menu(app: &App<Wry>) -> Result<tauri::menu::Menu<Wry>, tauri::Error> {
    let about_label = format!("About {}", app_display_name(app));

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("file_new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file_open_file", "Open File")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file_open_folder", "Open Folder")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file_save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file_save_as", "Save As")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file_export", "Export...")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file_close_tab", "Close File")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file_quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit_find", "Find")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit_replace", "Replace")
                .accelerator("CmdOrCtrl+H")
                .build(app)?,
        )
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("view_toggle_sidebar", "Toggle Sidebar")
                .accelerator("CmdOrCtrl+\\")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("view_zoom_in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view_zoom_out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("view_focus_mode", "Toggle Focus Mode")
                .accelerator("CmdOrCtrl+Shift+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view_debug", "Toggle Debug")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?,
        )
        .build()?;

    let format_menu = SubmenuBuilder::new(app, "Format")
        .item(
            &MenuItemBuilder::with_id("format_bold", "Bold")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format_italic", "Italic")
                .accelerator("CmdOrCtrl+I")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format_code", "Code")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format_strikethrough", "Strikethrough")
                .accelerator("CmdOrCtrl+Shift+X")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format_highlight", "Highlight")
                .accelerator("CmdOrCtrl+Shift+H")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("format_link", "Link")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help_about", about_label).build(app)?)
        .item(
            &MenuItemBuilder::with_id("help_shortcuts", "Keyboard Shortcuts")
                .accelerator("CmdOrCtrl+/")
                .build(app)?,
        )
        .build()?;

    MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &view_menu, &format_menu, &help_menu])
        .build()
}

fn app_display_name(app: &App<Wry>) -> &str {
    app.config().product_name.as_deref().unwrap_or("Coflat")
}

/// Register the menu event handler that emits events to the frontend.
pub fn setup_menu_events(app: &App<Wry>) {
    app.on_menu_event(move |app_handle, event| {
        let id = event.id().0.as_str();

        // PredefinedMenuItems (Undo, Redo, Cut, Copy, Paste, Select All) are
        // handled natively by the OS and don't fire on_menu_event, so we only
        // need to handle custom menu items here.

        // Route app-menu events to the focused webview window when possible so
        // multiple editor windows don't all execute the same command.
        if let Some(label) =
            focused_webview_label(app_handle).or_else(|| last_focused_webview_label(app_handle))
        {
            let _ = app_handle.emit_to(label.as_str(), "menu-event", id);
            return;
        }

        eprintln!(
            "[menu] dropped menu event '{}' because no target window was available",
            id
        );
    });
}

fn focused_webview_label(app_handle: &AppHandle<Wry>) -> Option<String> {
    app_handle
        .webview_windows()
        .into_iter()
        .find_map(|(label, window)| match window.is_focused() {
            Ok(true) => Some(label),
            _ => None,
        })
}

fn last_focused_webview_label(app_handle: &AppHandle<Wry>) -> Option<String> {
    let label = {
        let state = app_handle.state::<LastFocusedWindow>();
        state.0.lock().ok()?.clone()?
    };

    app_handle.get_webview_window(&label).map(|_| label)
}
