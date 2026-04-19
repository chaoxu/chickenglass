use std::sync::Mutex;

/// Shared state remembering the last webview window that held native focus.
pub struct LastFocusedWindow(pub Mutex<Option<String>>);
