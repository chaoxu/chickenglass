use std::path::PathBuf;
use std::sync::Mutex;

use notify::RecommendedWatcher;

/// Shared state holding the currently opened project directory.
pub struct ProjectRoot(pub Mutex<Option<PathBuf>>);

/// Shared state holding the active file watcher (if any).
pub struct FileWatcherState(pub Mutex<Option<RecommendedWatcher>>);
