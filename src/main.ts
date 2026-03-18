import { App, createDemoFileSystem, FileWatcher } from "./app";
import { isTauri, openFolder, TauriFileSystem } from "./app/tauri-fs";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app element");
}

// Start with demo content in both browser and Tauri.
// In Tauri, a toolbar button lets the user open a real folder.
const demoFs = createDemoFileSystem();
let app = new App({ root, fs: demoFs });
app.init("main.md");

/** Active file watcher (Tauri only). */
let fileWatcher: FileWatcher | null = null;

/** Create a FileWatcher wired to the given App instance. */
function createFileWatcher(target: App): FileWatcher {
  return new FileWatcher({
    isFileOpen: (path) => target.isFileOpen(path),
    isFileDirty: (path) => target.isFileDirty(path),
    reloadFile: (path) => target.reloadFile(path),
    container: target.getRoot(),
  });
}

// In Tauri, add an "Open Folder" button to the sidebar header.
if (isTauri()) {
  const openBtn = document.createElement("button");
  openBtn.textContent = "Open Folder";
  openBtn.className = "open-folder-btn";
  openBtn.addEventListener("click", async () => {
    const path = await openFolder();
    if (!path) return;

    // Stop any existing file watcher
    if (fileWatcher) {
      await fileWatcher.unwatch();
      fileWatcher = null;
    }

    const tauriFs = new TauriFileSystem();
    app.destroy();
    root.innerHTML = "";
    const newApp = new App({ root, fs: tauriFs });
    app = newApp;

    // Open the first .md file found, or just show the file tree
    await newApp.init();

    // Start watching the opened directory for external changes
    fileWatcher = createFileWatcher(newApp);
    await fileWatcher.watch(path);
  });
  // Insert after the files header
  const filesHeader = root.querySelector(".sidebar-section-header");
  if (filesHeader) {
    filesHeader.appendChild(openBtn);
  }
}
