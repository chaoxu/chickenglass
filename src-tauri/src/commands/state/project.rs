use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// Shared state holding the currently opened project directory.
pub struct ProjectRootEntry {
    pub generation: u64,
    pub path: PathBuf,
}

pub struct ProjectRoot(pub Mutex<HashMap<String, ProjectRootEntry>>);
