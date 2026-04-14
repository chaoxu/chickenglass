/**
 * interaction-trace-plugin — Traces click targets and scroll jumps.
 *
 * Activated by the `commandLogging` dev setting. Uses document-level capture
 * listeners to catch ALL clicks on the editor, including those consumed
 * by high-priority Lexical handlers (e.g. inline math).
 *
 * The listeners attach to `document` exactly once (module-level guard)
 * and read current state via a shared ref box. This avoids churn from
 * React strict-mode double-mount or HMR cycles.
 *
 * Results are logged to the console and persisted via session-recorder
 * to /tmp/coflat-debug/ for post-mortem analysis.
 */

import { useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNearestNodeFromDOMNode, type LexicalEditor } from "lexical";

import { useDevSettings } from "../app/dev-settings";
import { useEditorScrollSurface } from "../lexical-next";
import { recordDebugSessionEvent } from "../debug/session-recorder";
import { pushTraceEntry, type InteractionTraceEntry } from "./interaction-trace";

/** Selector for the main (non-nested) editor root. */
const MAIN_ROOT_SELECTOR = "[data-lexical-editor].cf-lexical-editor--rich";

function domTargetSummary(el: EventTarget | null): string {
  if (!(el instanceof HTMLElement)) return "(non-element)";
  const tag = el.tagName.toLowerCase();
  const cls = el.className
    ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}`
    : "";
  return `${tag}${cls}`;
}

// ---- Shared state box written by the React component, read by handlers. ----

interface TraceState {
  enabled: boolean;
  editor: LexicalEditor | null;
  surface: HTMLElement | null;
  scrollBefore: number;
}

const state: TraceState = {
  enabled: false,
  editor: null,
  surface: null,
  scrollBefore: 0,
};

// ---- Module-level listeners (attached once, never removed). ----

let listenersAttached = false;

function findMainRoot(node: Node): HTMLElement | null {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest<HTMLElement>(MAIN_ROOT_SELECTOR) ?? null;
}

function handleMouseDown(event: MouseEvent) {
  if (!state.enabled) return;
  if (!(event.target instanceof Node) || !findMainRoot(event.target)) return;
  state.scrollBefore = state.surface?.scrollTop ?? 0;
}

function handleClick(event: MouseEvent) {
  if (!state.enabled) return;
  if (!(event.target instanceof Node)) return;
  const root = findMainRoot(event.target);
  if (!root) return;

  const currentEditor = state.editor;
  const scrollSurface = state.surface;
  const scrollBefore = state.scrollBefore;
  const handled = event.defaultPrevented;

  // Resolve Lexical node from click target.
  let nodeType: string | null = null;
  let nodeKey: string | null = null;
  try {
    if (currentEditor && event.target instanceof Node) {
      currentEditor.getEditorState().read(() => {
        const node = $getNearestNodeFromDOMNode(event.target as Node);
        if (node) {
          nodeType = node.getType();
          nodeKey = node.getKey();
        }
      });
    }
  } catch {
    // Node resolution can fail for detached DOM — that's fine.
  }

  const targetSummary = domTargetSummary(event.target);

  // Monitor scroll for 500ms after click to catch delayed jumps.
  let scrollAfter = scrollBefore;
  let jumpDetected = false;
  const onScroll = () => {
    const current = scrollSurface?.scrollTop ?? 0;
    if (current !== scrollBefore && !jumpDetected) {
      jumpDetected = true;
      scrollAfter = current;
    }
  };

  scrollSurface?.addEventListener("scroll", onScroll, { passive: true });

  setTimeout(() => {
    scrollSurface?.removeEventListener("scroll", onScroll);
    if (!jumpDetected) {
      scrollAfter = scrollSurface?.scrollTop ?? 0;
    }

    const entry: InteractionTraceEntry = {
      ts: Date.now(),
      type: scrollAfter !== scrollBefore ? "scroll-jump" : "click",
      nodeType,
      nodeKey,
      target: targetSummary,
      scrollBefore,
      scrollAfter,
      handled,
    };

    pushTraceEntry(entry);

    recordDebugSessionEvent({
      timestamp: entry.ts,
      type: entry.type,
      summary: `${entry.type} ${nodeType ?? targetSummary} delta=${scrollAfter - scrollBefore}`,
      detail: entry,
    });

    if (entry.type === "scroll-jump") {
      console.warn(
        "[scroll-jump]",
        `node=${nodeType ?? "?"}`,
        `delta=${scrollAfter - scrollBefore}`,
        entry,
      );
    } else {
      console.debug(
        "[click-trace]",
        `node=${nodeType ?? "?"}`,
        `target=${targetSummary}`,
        entry,
      );
    }
  }, 500);
}

function ensureListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("click", handleClick, true);
}

// ---- React component — syncs state box, attaches listeners once. ----

export function InteractionTracePlugin() {
  const enabled = useDevSettings((s) => s.commandLogging);
  const [editor] = useLexicalComposerContext();
  const surface = useEditorScrollSurface();

  // Sync mutable state on every render.
  state.enabled = enabled;
  state.editor = editor;
  state.surface = surface;

  // Ensure document listeners exist (idempotent).
  const didAttach = useRef(false);
  if (!didAttach.current) {
    didAttach.current = true;
    ensureListeners();
  }

  return null;
}
