import { App, createDemoFileSystem } from "./app";
import { isTauri, openFolder, TauriFileSystem } from "./app/tauri-fs";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app element");
}

// Start with demo content in both browser and Tauri.
// In Tauri, a toolbar button lets the user open a real folder.
const demoFs = createDemoFileSystem();
const app = new App({ root, fs: demoFs });
app.init("main.md");

// In Tauri, add an "Open Folder" button to the sidebar header.
if (isTauri()) {
  const openBtn = document.createElement("button");
  openBtn.textContent = "Open Folder";
  openBtn.className = "open-folder-btn";
  openBtn.addEventListener("click", async () => {
    const path = await openFolder();
    if (!path) return;
    const tauriFs = new TauriFileSystem();
    app.destroy();
    root.innerHTML = "";
    const newApp = new App({ root, fs: tauriFs });
    // Open the first .md file found, or just show the file tree
    newApp.init();
  });
  // Insert after the files header
  const filesHeader = root.querySelector(".sidebar-section-header");
  if (filesHeader) {
    filesHeader.appendChild(openBtn);
  }
}
