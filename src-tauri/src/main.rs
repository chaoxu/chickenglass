// Prevents a console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;

use commands::{FileWatcherState, ProjectRoot};
use std::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProjectRoot(Mutex::new(None)))
        .manage(FileWatcherState(Mutex::new(None)))
        .setup(|app| {
            let menu = menu::build_menu(app)?;
            app.set_menu(menu)?;
            menu::setup_menu_events(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_folder,
            commands::read_file,
            commands::write_file,
            commands::create_file,
            commands::file_exists,
            commands::rename_file,
            commands::delete_file,
            commands::list_tree,
            commands::check_pandoc,
            commands::export_document,
            commands::watch_directory,
            commands::unwatch_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chickenglass");
}
