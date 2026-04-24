import { basename } from "../lib/utils";
import { activeCoflatProduct } from "../product";
import {
  buildWindowState,
  saveWindowStateForLabel,
} from "./window-state";

function createWindowLabel(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `document-${Date.now()}-${suffix}`;
}

export async function openDocumentInNewWindow(
  projectRoot: string,
  path: string,
): Promise<void> {
  // Lazy-import to keep @tauri-apps/api out of the browser bundle (#446).
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

  const label = createWindowLabel();
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("projectRoot", projectRoot);
  nextUrl.searchParams.set("file", path);
  saveWindowStateForLabel(label, buildWindowState({
    currentDocument: {
      path,
      name: basename(path),
    },
    projectRoot,
  }));

  const nextWindow = new WebviewWindow(label, {
    center: true,
    focus: true,
    height: 800,
    minHeight: 600,
    minWidth: 800,
    title: `${activeCoflatProduct.displayName} — ${basename(path)}`,
    url: nextUrl.toString(),
    visible: true,
    width: 1200,
  });

  await new Promise<void>((resolve, reject) => {
    void nextWindow.once("tauri://created", () => resolve());
    void nextWindow.once("tauri://error", (event) => reject(event));
  });

  if ("setFocus" in nextWindow && typeof nextWindow.setFocus === "function") {
    await nextWindow.setFocus().catch(() => {
      // best-effort: some platforms may already focus the new window
    });
  }
}
