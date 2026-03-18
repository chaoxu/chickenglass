import { App, createDemoFileSystem, FileWatcher } from "./app";
import type { Theme } from "./app/theme-manager";
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

// ── Theme switcher ────────────────────────────────────────────────────────────
// Inject a small Light / Dark / System toggle into the sidebar footer.
// Re-queried after each App re-creation (Open Folder) via mountThemeSwitcher.

const THEME_LABELS: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Mount (or re-mount) the theme switcher inside the sidebar element. */
function mountThemeSwitcher(target: App): void {
  const sidebar = target.getSidebar().element;

  const switcher = document.createElement("div");
  switcher.className = "theme-switcher";

  const label = document.createElement("span");
  label.className = "theme-switcher-label";
  label.textContent = "Theme";
  switcher.appendChild(label);

  const buttons: HTMLButtonElement[] = [];

  for (const { value, label: btnLabel } of THEME_LABELS) {
    const btn = document.createElement("button");
    btn.className = "theme-btn";
    btn.type = "button";
    btn.textContent = btnLabel;
    btn.addEventListener("click", () => {
      target.setTheme(value);
      updateActive(value);
    });
    buttons.push(btn);
    switcher.appendChild(btn);
  }

  const updateActive = (active: Theme): void => {
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle(
        "theme-btn-active",
        THEME_LABELS[i].value === active,
      );
    }
  };

  updateActive(target.getTheme());
  sidebar.appendChild(switcher);
}

mountThemeSwitcher(app);

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

// Window close handling: prompt to save dirty tabs before closing.
if (isTauri()) {
  // Tauri: intercept the native window close request
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    getCurrentWindow().onCloseRequested(async (event) => {
      const canClose = await app.confirmCloseAll();
      if (!canClose) {
        event.preventDefault();
      }
    });
  });
} else {
  // Browser: use beforeunload to warn about unsaved changes
  window.addEventListener("beforeunload", (event) => {
    const dirtyTabs = app.getDirtyTabs();
    if (dirtyTabs.length > 0) {
      event.preventDefault();
    }
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

    // Re-mount the theme switcher after sidebar is rendered
    mountThemeSwitcher(newApp);

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
