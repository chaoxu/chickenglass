// Prevents a console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;

use commands::state::{FileWatcherState, PerfState, ProjectRoot};
use std::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProjectRoot(Mutex::new(None)))
        .manage(FileWatcherState(Mutex::new(None)))
        .manage(PerfState::new())
        .setup(|app| {
            let menu = menu::build_menu(app)?;
            app.set_menu(menu)?;
            menu::setup_menu_events(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::open_folder,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::create_directory,
            commands::fs::file_exists,
            commands::fs::rename_file,
            commands::fs::list_tree,
            commands::export::check_pandoc,
            commands::export::export_document,
            commands::watch::watch_directory,
            commands::watch::unwatch_directory,
            commands::fs::delete_file,
            commands::shell::reveal_in_finder,
            commands::fs::write_file_binary,
            commands::fs::read_file_binary,
            commands::path::to_project_relative_path,
            commands::perf::get_perf_snapshot,
            commands::perf::clear_perf_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Coflat");
}
