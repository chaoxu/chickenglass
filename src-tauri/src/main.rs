// Prevents a console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;
mod services;

use commands::state::{FileWatcherState, LastFocusedWindow, PerfState, ProjectRoot};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};
use tauri_plugin_log::TimezoneStrategy;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        .manage(ProjectRoot(Mutex::new(HashMap::new())))
        .manage(FileWatcherState(Mutex::new(HashMap::new())))
        .manage(LastFocusedWindow(Mutex::new(None)))
        .manage(PerfState::new())
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(true) = event {
                let last_focused = window.state::<LastFocusedWindow>();
                if let Ok(mut label) = last_focused.0.lock() {
                    *label = Some(window.label().to_string());
                }
            }
        })
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
            commands::fs::write_file_if_hash,
            commands::fs::create_file,
            commands::fs::create_directory,
            commands::fs::file_exists,
            commands::fs::rename_file,
            commands::fs::list_tree,
            commands::fs::list_children,
            commands::export::check_pandoc,
            commands::export::export_document,
            commands::watch::watch_directory,
            commands::watch::unwatch_directory,
            commands::fs::delete_file,
            commands::shell::reveal_in_finder,
            commands::shell::open_url,
            commands::fs::write_file_binary,
            commands::fs::read_file_binary,
            commands::path::to_project_relative_path,
            commands::perf::get_perf_snapshot,
            commands::perf::clear_perf_snapshot,
            commands::recovery::write_hot_exit_backup,
            commands::recovery::list_hot_exit_backups,
            commands::recovery::read_hot_exit_backup,
            commands::recovery::delete_hot_exit_backup,
            commands::debug::debug_list_windows,
            commands::debug::debug_get_native_state,
            commands::debug::debug_emit_file_changed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Coflats app");
}
