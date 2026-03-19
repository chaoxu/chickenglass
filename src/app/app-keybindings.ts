import type { ExportFormat } from "./export";

/** Zoom manager: controls --font-size-base CSS variable, persists in localStorage. */
const ZOOM_KEY = "cg-zoom-level";
const ZOOM_DEFAULT = 16;
const ZOOM_MIN = 10;
const ZOOM_MAX = 32;
const ZOOM_STEP = 2;

function clampZoom(value: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
}

function loadZoomLevel(): number {
  try {
    const stored = localStorage.getItem(ZOOM_KEY);
    return stored ? clampZoom(Number(stored)) : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

let currentZoomLevel = loadZoomLevel();

function applyZoomLevel(px: number): void {
  currentZoomLevel = clampZoom(px);
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

    if (e.shiftKey) {
      switch (e.key) {
        case "E": // Export to PDF
          e.preventDefault();
          actions.exportActiveFile("pdf");
          return;
        case "L": // Export to LaTeX
          e.preventDefault();
          actions.exportActiveFile("latex");
          return;
        case "H": // Export to HTML
          e.preventDefault();
          actions.exportActiveFile("html");
          return;
      }
      return;
    }

    switch (e.key) {
      case "s": // Save
        e.preventDefault();
        actions.saveActiveFile();
        return;
      case "=": // Zoom in
        e.preventDefault();
        applyZoomLevel(currentZoomLevel + ZOOM_STEP);
        return;
      case "-": // Zoom out
        e.preventDefault();
        applyZoomLevel(currentZoomLevel - ZOOM_STEP);
        return;
      case "0": // Reset zoom
        e.preventDefault();
        applyZoomLevel(ZOOM_DEFAULT);
        return;
    }
  };

  root.addEventListener("keydown", handler);
  return () => root.removeEventListener("keydown", handler);
}
