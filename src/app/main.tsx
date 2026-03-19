import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app.tsx";
import { createDemoFileSystem } from "./file-manager";
import { isTauri, TauriFileSystem } from "./tauri-fs";
import "../globals.css";

const rootEl = document.getElementById("app");
if (!rootEl) {
  throw new Error("Missing #app element");
}

const fs = isTauri() ? new TauriFileSystem() : createDemoFileSystem();

createRoot(rootEl).render(
  <StrictMode>
    <AppShell fs={fs} />
  </StrictMode>,
);
