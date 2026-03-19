import type { ExportFormat } from "./export";

/** Zoom manager: controls --font-size-base CSS variable, persists in localStorage. */
const ZOOM_KEY = "cg-zoom-level";
const ZOOM_DEFAULT = 16;
const ZOOM_MIN = 10;
const ZOOM_MAX = 32;
const ZOOM_STEP = 2;

let currentZoomLevel = (() => {
  try {
    const stored = localStorage.getItem(ZOOM_KEY);
    return stored ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(stored))) : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
})();

function applyZoomLevel(px: number): void {
  currentZoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, px));
  document.documentElement.style.setProperty("--font-size-base", `${currentZoomLevel}px`);
  localStorage.setItem(ZOOM_KEY, String(currentZoomLevel));
}

/** Callbacks the keybinding handler needs from the App. */
export interface KeybindingActions {
  saveActiveFile(): Promise<void>;
  exportActiveFile(format: ExportFormat): Promise<void>;
}

/**
 * Install app-level keyboard shortcuts on the given root element.
 * Returns a cleanup function that removes the listener.
 */
export function installAppKeybindings(
  root: HTMLElement,
  actions: KeybindingActions,
): () => void {
  const handler = (e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    // Cmd+S → Save
    if (e.key === "s" && !e.shiftKey) {
      e.preventDefault();
      actions.saveActiveFile();
    }
    // Cmd+Shift+E → Export to PDF
    if (e.shiftKey && e.key === "E") {
      e.preventDefault();
      actions.exportActiveFile("pdf");
    }
    // Cmd+Shift+L → Export to LaTeX
    if (e.shiftKey && e.key === "L") {
      e.preventDefault();
      actions.exportActiveFile("latex");
    }
    // Cmd+Shift+H → Export to HTML
    if (e.shiftKey && e.key === "H") {
      e.preventDefault();
      actions.exportActiveFile("html");
    }
    // Cmd+= → Zoom in
    if (!e.shiftKey && e.key === "=") {
      e.preventDefault();
      applyZoomLevel(currentZoomLevel + ZOOM_STEP);
    }
    // Cmd+- → Zoom out
    if (!e.shiftKey && e.key === "-") {
      e.preventDefault();
      applyZoomLevel(currentZoomLevel - ZOOM_STEP);
    }
    // Cmd+0 → Reset zoom
    if (!e.shiftKey && e.key === "0") {
      e.preventDefault();
      applyZoomLevel(ZOOM_DEFAULT);
    }
  };

  root.addEventListener("keydown", handler);
  return () => root.removeEventListener("keydown", handler);
}
