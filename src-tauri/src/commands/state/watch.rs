use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use notify::RecommendedWatcher;

/// Shared state holding the active file watcher (if any).
pub struct FileWatcherEntry {
    pub generation: u64,
    pub root: PathBuf,
    pub watcher: Option<RecommendedWatcher>,
}

pub struct FileWatcherState(pub Mutex<HashMap<String, FileWatcherEntry>>);
