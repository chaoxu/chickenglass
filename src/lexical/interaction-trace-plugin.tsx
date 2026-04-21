/**
 * interaction-trace-plugin — Traces editor clicks, text input, and scroll jumps.
 *
 * Activated by the `commandLogging` dev setting. Uses root-level capture
 * listeners to catch clicks on the editor, including those consumed by
 * high-priority Lexical handlers (e.g. inline math), without keeping debug
 * listeners on global input paths while logging is disabled.
 *
 * Results are logged to the console and persisted via session-recorder
 * to /tmp/coflat-debug/ for post-mortem analysis.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNearestNodeFromDOMNode, type LexicalEditor } from "lexical";

import { useDevSettings } from "../state/dev-settings";
import { useEditorScrollSurface } from "./runtime";
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

function lexicalNodeForTarget(
  editor: LexicalEditor | null,
  target: EventTarget | null,
): { readonly nodeKey: string | null; readonly nodeType: string | null } {
  let nodeType: string | null = null;
  let nodeKey: string | null = null;
  try {
    if (editor && target instanceof Node) {
      editor.getEditorState().read(() => {
        const node = $getNearestNodeFromDOMNode(target);
        if (node) {
          nodeType = node.getType();
          nodeKey = node.getKey();
        }
      });
    }
  } catch {
    // Node resolution can fail for detached DOM — that's fine.
  }
  return { nodeKey, nodeType };
}

function pointerPosition(
  event: MouseEvent,
  root: HTMLElement,
): {
  readonly clientX: number;
  readonly clientY: number;
  readonly editorX: number;
  readonly editorY: number;
} {
  const rect = root.getBoundingClientRect();
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    editorX: event.clientX - rect.left,
    editorY: event.clientY - rect.top,
  };
}

export function InteractionTracePlugin() {
  const enabled = useDevSettings((s) => s.commandLogging);
  const [editor] = useLexicalComposerContext();
  const surface = useEditorScrollSurface();

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let attachedRoot: HTMLElement | null = null;
    let scrollBefore = 0;

    const handleMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      scrollBefore = surface?.scrollTop ?? 0;
    };

    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !attachedRoot) return;

      const scrollSurface = surface;
      const handled = event.defaultPrevented;

      const { nodeKey, nodeType } = lexicalNodeForTarget(editor, event.target);
      const targetSummary = domTargetSummary(event.target);
      const position = pointerPosition(event, attachedRoot);

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
          ...position,
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
    };

    const handleBeforeInput = (event: InputEvent) => {
      if (!(event.target instanceof Node)) return;

      const { nodeKey, nodeType } = lexicalNodeForTarget(editor, event.target);
      const entry: InteractionTraceEntry = {
        ts: Date.now(),
        type: "input",
        nodeType,
        nodeKey,
        target: domTargetSummary(event.target),
        scrollBefore: surface?.scrollTop ?? 0,
        scrollAfter: surface?.scrollTop ?? 0,
        handled: event.defaultPrevented,
        inputType: event.inputType,
        data: event.data,
      };

      pushTraceEntry(entry);
      recordDebugSessionEvent({
        timestamp: entry.ts,
        type: entry.type,
        summary: `input ${entry.inputType} ${nodeType ?? entry.target}`,
        detail: entry,
      });
    };

    const detach = () => {
      if (!attachedRoot) {
        return;
      }
      attachedRoot.removeEventListener("mousedown", handleMouseDown, true);
      attachedRoot.removeEventListener("beforeinput", handleBeforeInput, true);
      attachedRoot.removeEventListener("click", handleClick, true);
      attachedRoot = null;
    };

    const unregisterRoot = editor.registerRootListener((rootElement) => {
      detach();
      if (!rootElement?.matches(MAIN_ROOT_SELECTOR)) {
        return;
      }
      attachedRoot = rootElement;
      rootElement.addEventListener("mousedown", handleMouseDown, true);
      rootElement.addEventListener("beforeinput", handleBeforeInput, true);
      rootElement.addEventListener("click", handleClick, true);
    });

    return () => {
      detach();
      unregisterRoot();
    };
  }, [editor, enabled, surface]);

  return null;
}
