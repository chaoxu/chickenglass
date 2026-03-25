import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app.tsx";
import { isTauri } from "../lib/tauri";
import "../globals.css";

async function bootstrap(): Promise<void> {
  const rootEl = document.getElementById("app");
  if (!rootEl) {
    throw new Error("Missing #app element");
  }

  const fs = isTauri()
    ? new (await import("./tauri-fs")).TauriFileSystem()
    : await (await import("./file-manager")).createBlogDemoFileSystem();

  createRoot(rootEl).render(
    <StrictMode>
      <AppShell fs={fs} />
    </StrictMode>,
  );
}

void bootstrap();
