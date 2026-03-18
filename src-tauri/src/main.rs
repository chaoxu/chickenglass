// Prevents a console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::ProjectRoot;
use std::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProjectRoot(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::open_folder,
            commands::read_file,
            commands::write_file,
            commands::create_file,
            commands::file_exists,
            commands::list_tree,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chickenglass");
}
