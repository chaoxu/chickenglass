import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  getShellSurfaceSnapshot,
  measureShellSurfaceSnapshot,
  setShellSurfaceSnapshot,
  shellSurfaceUpdateEvent,
  type ShellSurface,
  type ShellSurfaceSnapshot,
} from "./shell-surface-model";

function sameSnapshot(
  left: ShellSurfaceSnapshot | null,
  right: ShellSurfaceSnapshot,
): boolean {
  if (!left) return false;
  if (left.surfaces.length !== right.surfaces.length) return false;
  return left.surfaces.every((surface, index) => {
    const other = right.surfaces[index];
    if (
      surface.key !== other.key ||
      surface.depth !== other.depth ||
      surface.label !== other.label
    ) {
      return false;
    }
    if (surface.rect === null || other.rect === null) {
      return surface.rect === other.rect;
    }
    return (
      surface.rect.left === other.rect.left &&
      surface.rect.right === other.rect.right &&
      surface.rect.top === other.rect.top &&
      surface.rect.bottom === other.rect.bottom
    );
  });
}

function surfaceLabel(surface: ShellSurface): string {
  return `${surface.depth + 1}:${surface.label}`;
}

class ShellSurfaceOverlayView {
  readonly dom: HTMLElement;
  private view: EditorView;
  private measureQueued = false;
  private readonly handleScroll: () => void;
  private readonly handleResize: () => void;

  constructor(view: EditorView) {
    this.view = view;
    this.dom = document.createElement("div");
    this.dom.className = "cf-shell-surface-layer";
    document.body.appendChild(this.dom);
    this.handleScroll = () => {
      this.scheduleMeasure();
    };
    this.handleResize = () => {
      this.scheduleMeasure();
    };
    view.scrollDOM.addEventListener("scroll", this.handleScroll, { passive: true });
    window.addEventListener("resize", this.handleResize);
    this.scheduleMeasure();
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.transactions.some((tr) => tr.effects.length > 0)
    ) {
      this.scheduleMeasure();
    }
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener("scroll", this.handleScroll);
    window.removeEventListener("resize", this.handleResize);
    this.dom.remove();
  }

  private scheduleMeasure(): void {
    if (this.measureQueued) return;
    this.measureQueued = true;
    this.view.requestMeasure({
      read: (view) => measureShellSurfaceSnapshot(view),
      write: (snapshot, view) => {
        this.measureQueued = false;
        const previous = getShellSurfaceSnapshot(view);
        setShellSurfaceSnapshot(view, snapshot);
        view.dom.dispatchEvent(
          new CustomEvent(shellSurfaceUpdateEvent, {
            detail: snapshot,
          }),
        );
        if (!sameSnapshot(previous, snapshot)) {
          this.render(snapshot);
        }
      },
    });
  }

  private render(snapshot: ShellSurfaceSnapshot): void {
    this.dom.textContent = "";
    for (const surface of snapshot.surfaces) {
      if (!surface.rect) continue;
      const box = document.createElement("div");
      box.className = "cf-shell-surface-box";
      box.dataset.depth = String(surface.depth);
      box.style.left = `${surface.rect.left}px`;
      box.style.top = `${surface.rect.top}px`;
      box.style.width = `${surface.rect.width}px`;
      box.style.height = `${surface.rect.height}px`;
      const label = document.createElement("div");
      label.className = "cf-shell-surface-label";
      label.textContent = surfaceLabel(surface);
      box.appendChild(label);
      this.dom.appendChild(box);
    }
  }
}

export const shellSurfaceOverlayExtension: Extension =
  ViewPlugin.fromClass(ShellSurfaceOverlayView);
