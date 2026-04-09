import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app.tsx";
import { isTauri } from "../lib/tauri";
import { configureExternalUrlOpener } from "../lib/open-link";
import {
  clearDynamicImportRecoveryFlag,
  installDynamicImportRecovery,
} from "./dynamic-import-recovery";
import { installRuntimeLogging } from "./runtime-logger";
import "../globals.css";

if (import.meta.env.DEV) {
  installDynamicImportRecovery();
}

async function bootstrap(): Promise<void> {
  await installRuntimeLogging();

  const rootEl = document.getElementById("app");
  if (!rootEl) {
    throw new Error("Missing #app element");
  }

  if (isTauri()) {
    configureExternalUrlOpener(async (url) => {
      const { invokeWithPerf } = await import("./perf");
      await invokeWithPerf("open_url", { url });
      return true;
    });
  }

  const fs = isTauri()
    ? new (await import("./tauri-fs")).TauriFileSystem()
    : await (await import("./file-manager")).createBlogDemoFileSystem();

  createRoot(rootEl).render(
    <StrictMode>
      <AppShell fs={fs} />
    </StrictMode>,
  );

  if (import.meta.env.DEV) {
    clearDynamicImportRecoveryFlag();
  }
}

void bootstrap();
