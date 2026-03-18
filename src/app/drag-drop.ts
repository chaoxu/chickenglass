/**
 * Window-level drag-and-drop handler for Chickenglass.
 *
 * - Drop a .md file  → calls onOpenFile(path) to open it in the editor.
 * - Drop an image    → calls onInsertImage(markdown) to insert ![](data:…)
 *                      at the current cursor position.
 *
 * A translucent overlay is shown while files are dragged over the window,
 * giving the user a clear visual affordance for the drop target.
 *
 * Call installDragDrop() once at app startup to wire up the listeners.
 * Call the returned cleanup function to remove all listeners.
 */

/** Callbacks provided by the application shell. */
export interface DragDropCallbacks {
  /** Called when a .md file is dropped. Receives the File object. */
  onOpenFile: (file: File) => void;
  /** Called when an image file is dropped. Receives an `![alt](src)` string. */
  onInsertImage: (markdown: string) => void;
}

/** Result of installDragDrop — call destroy() to remove all listeners. */
export interface DragDropHandle {
  destroy: () => void;
}

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/**
 * Install window-level drag-and-drop handling.
 *
 * @param callbacks - Handlers for dropped markdown files and images.
 * @returns A handle with a destroy() method that removes all listeners.
 */
export function installDragDrop(callbacks: DragDropCallbacks): DragDropHandle {
  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  /** Track drag depth so the overlay doesn't flicker on child-element transitions. */
  let dragDepth = 0;

  const onDragEnter = (e: DragEvent): void => {
    e.preventDefault();
    dragDepth++;
    if (dragDepth === 1) showOverlay(overlay, e.dataTransfer);
  };

  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = getDropEffect(e.dataTransfer);
    }
  };

  const onDragLeave = (e: DragEvent): void => {
    // Only count leaves that actually exit the window
    if (e.relatedTarget === null) {
      dragDepth = 0;
      hideOverlay(overlay);
    } else {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideOverlay(overlay);
    }
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    dragDepth = 0;
    hideOverlay(overlay);

    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const file of files) {
      if (file.name.endsWith(".md")) {
        callbacks.onOpenFile(file);
      } else if (IMAGE_TYPES.has(file.type)) {
        readImageAsDataUrl(file)
          .then((src) => {
            const alt = file.name.replace(/\.[^.]+$/, "");
            callbacks.onInsertImage(`![${alt}](${src})`);
          })
          .catch((err: unknown) => {
            console.error("[chickenglass] drag-drop image read failed:", err);
          });
      }
    }
  };

  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);

  return {
    destroy(): void {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      overlay.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a File as a base-64 data URL. */
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(reader.result as string);
    reader.onerror = (): void => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

/** Determine the appropriate dropEffect for the current drag. */
function getDropEffect(dt: DataTransfer): "copy" | "none" {
  const items = Array.from(dt.items);
  const hasRelevant = items.some((item) => {
    if (item.kind !== "file") return false;
    return item.type === "" /* .md, type unknown in dragover */ ||
      item.type.startsWith("image/");
  });
  return hasRelevant ? "copy" : "none";
}

// ---------------------------------------------------------------------------
// Overlay DOM
// ---------------------------------------------------------------------------

const OVERLAY_ID = "cg-drop-overlay";
const STYLE_ID = "cg-drop-styles";

function buildOverlay(): HTMLElement {
  injectStyles();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "cg-drop-overlay";
  overlay.setAttribute("aria-hidden", "true");

  const label = document.createElement("div");
  label.className = "cg-drop-label";
  label.textContent = "Drop to open";
  overlay.appendChild(label);

  return overlay;
}

function showOverlay(overlay: HTMLElement, dt: DataTransfer | null): void {
  const label = overlay.querySelector<HTMLElement>(".cg-drop-label");
  if (label && dt) {
    const items = Array.from(dt.items).filter((i) => i.kind === "file");
    const hasMd = items.some((i) => i.type === "");
    const hasImg = items.some((i) => i.type.startsWith("image/"));
    if (hasMd && hasImg) {
      label.textContent = "Drop to open or insert";
    } else if (hasImg) {
      label.textContent = "Drop to insert image";
    } else {
      label.textContent = "Drop to open";
    }
  }
  overlay.classList.add("cg-drop-overlay--active");
}

function hideOverlay(overlay: HTMLElement): void {
  overlay.classList.remove("cg-drop-overlay--active");
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.cg-drop-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 102, 204, 0.12);
  border: 3px dashed rgba(0, 102, 204, 0.5);
  pointer-events: none;
  align-items: center;
  justify-content: center;
}

.cg-drop-overlay--active {
  display: flex;
}

.cg-drop-label {
  background: rgba(0, 102, 204, 0.85);
  color: #fff;
  font-size: 1.1rem;
  font-weight: 600;
  padding: 0.6rem 1.4rem;
  border-radius: 6px;
  pointer-events: none;
  letter-spacing: 0.02em;
}
  `.trim();

  document.head.appendChild(style);
}
