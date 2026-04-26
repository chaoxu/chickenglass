import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app.tsx";
import { activeCoflatProduct } from "../product";
import { isTauri } from "../lib/tauri";
import { configureExternalUrlOpener } from "../lib/open-link";
import {
  clearDynamicImportRecoveryFlag,
  installDynamicImportRecovery,
} from "./dynamic-import-recovery";
import { installTauriRenderDiagnostics } from "../debug/editor-runtime-contract";
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

  document.title = activeCoflatProduct.displayName;
  document.documentElement.dataset.coflatProduct = activeCoflatProduct.id;

  if (isTauri()) {
    configureExternalUrlOpener(async (url) => {
      const { openUrlCommand } = await import("./tauri-client/shell");
      await openUrlCommand(url);
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

  void installTauriRenderDiagnostics();

  if (import.meta.env.DEV) {
    clearDynamicImportRecoveryFlag();
  }
}

void bootstrap();
