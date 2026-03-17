/**
 * Math preview modal.
 *
 * Shows a floating panel with a live KaTeX preview when the cursor
 * is inside an InlineMath or DisplayMath node. The panel is draggable
 * via its title bar and has a close button.
 */

import {
  type EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import katex from "katex";
import { stripMathDelimiters, MATH_TYPES } from "./math-render";
import { getMathMacros } from "./math-macros";
import { cursorInRange } from "./render-utils";

interface MathNodeInfo {
  readonly from: number;
  readonly to: number;
  readonly isDisplay: boolean;
}

/** Find the math node containing the cursor, if any. */
function findMathAtCursor(view: EditorView): MathNodeInfo | null {
  if (!view.hasFocus) return null;
  let result: MathNodeInfo | null = null;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (MATH_TYPES.has(node.name)) {
          if (cursorInRange(view, node.from, node.to)) {
            result = {
              from: node.from,
              to: node.to,
              isDisplay: node.name === "DisplayMath",
            };
          }
        }
      },
    });
  }

  return result;
}

class MathPreviewPlugin implements PluginValue {
  private panel: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private cleanupListeners: (() => void) | null = null;
  private lastRaw = "";
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(private view: EditorView) {
    this.check();
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged
    ) {
      this.view = update.view;
      this.check();
    }
  }

  destroy(): void {
    this.removePanel();
  }

  private check(): void {
    const info = findMathAtCursor(this.view);

    if (!info) {
      this.removePanel();
      return;
    }

    const raw = this.view.state.sliceDoc(info.from, info.to);
    const latex = stripMathDelimiters(raw, info.isDisplay);

    if (!this.panel) {
      this.createPanel(info);
    } else {
      this.positionPanel(info);
    }

    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      this.renderLatex(latex, info.isDisplay);
    }
  }

  private createPanel(info: MathNodeInfo): void {
    const panel = document.createElement("div");
    panel.className = "cg-math-preview";

    // Title bar (draggable)
    const titleBar = document.createElement("div");
    titleBar.className = "cg-math-preview-titlebar";
    titleBar.textContent = "Math Preview";

    titleBar.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      const rect = panel.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging || !this.panel) return;
      this.panel.style.left = `${e.clientX - this.dragOffsetX}px`;
      this.panel.style.top = `${e.clientY - this.dragOffsetY}px`;
    };

    const onMouseUp = () => {
      this.isDragging = false;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "cg-math-preview-close";
    closeBtn.textContent = "\u00D7";
    closeBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.removePanel();
    });

    titleBar.appendChild(closeBtn);
    panel.appendChild(titleBar);

    // Content area
    const content = document.createElement("div");
    content.className = "cg-math-preview-content";
    panel.appendChild(content);

    this.contentEl = content;
    this.panel = panel;
    this.lastRaw = "";

    // Store cleanup for document-level listeners
    this.cleanupListeners = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.body.appendChild(panel);
    this.positionPanel(info);
  }

  private positionPanel(info: MathNodeInfo): void {
    if (!this.panel || this.isDragging) return;

    const coords = this.view.coordsAtPos(info.from);
    if (!coords) return;

    this.panel.style.left = `${coords.left}px`;
    this.panel.style.top = `${coords.bottom + 8}px`;
  }

  private renderLatex(latex: string, isDisplay: boolean): void {
    if (!this.contentEl) return;
    const macros = getMathMacros(this.view.state);

    try {
      katex.render(latex, this.contentEl, {
        displayMode: isDisplay,
        throwOnError: false,
        output: "htmlAndMathml",
        macros: { ...macros },
      });
    } catch (err: unknown) {
      this.contentEl.textContent =
        err instanceof Error ? err.message : "KaTeX error";
      this.contentEl.style.color = "#c00";
    }
  }

  private removePanel(): void {
    if (!this.panel) return;
    this.cleanupListeners?.();
    this.cleanupListeners = null;
    this.panel.remove();
    this.panel = null;
    this.contentEl = null;
    this.lastRaw = "";
  }
}

/** CM6 extension that shows a floating KaTeX preview when editing math. */
export const mathPreviewPlugin: Extension = ViewPlugin.fromClass(
  MathPreviewPlugin,
);
