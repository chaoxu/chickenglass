import { useEffect, useRef, useState } from "react";
import { $createAutoLinkNode, $createLinkNode, $isAutoLinkNode, $isLinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  type NodeKey,
} from "lexical";

import { SurfaceFloatingPortal } from "../lexical-next";
import { EditorChromeBody, EditorChromeInput, EditorChromePanel } from "./editor-chrome";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

interface EditingLinkState {
  readonly anchor: HTMLAnchorElement;
  readonly nodeKey: NodeKey;
  readonly raw: string;
}

function serializeMarkdownLink(text: string, url: string): string {
  return `[${text}](${url})`;
}

function parseMarkdownLink(raw: string): { text: string; url: string } | null {
  const match = raw.trim().match(/^\[([\s\S]*)\]\(([^)\n]+)\)$/);
  if (!match) {
    return null;
  }
  return {
    text: match[1],
    url: match[2].trim(),
  };
}

function resolveLinkElement(target: EventTarget | null): HTMLAnchorElement | null {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  return element?.closest<HTMLAnchorElement>("a.cf-lexical-link") ?? null;
}

export function LinkSourcePlugin() {
  const [editor] = useLexicalComposerContext();
  const [editing, setEditing] = useState<EditingLinkState | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft("");
      return;
    }
    setDraft(editing.raw);
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    return editor.registerRootListener((rootElement, previousRootElement) => {
      const detach = (element: HTMLElement | null) => {
        if (!element) {
          return;
        }
        element.removeEventListener("mousedown", handleMouseDown, true);
        element.removeEventListener("click", handleClick, true);
      };

      const handleMouseDown = (event: MouseEvent) => {
        const target = resolveLinkElement(event.target);
        if (!target) {
          return;
        }

        const ownerRoot = target.closest<HTMLElement>(".cf-lexical-editor");
        if (ownerRoot !== rootElement) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        let nextEditing: EditingLinkState | null = null;
        editor.read(() => {
          let node = $getNearestNodeFromDOMNode(target);
          while (node && !$isLinkNode(node) && !$isAutoLinkNode(node)) {
            node = node.getParent();
          }
          if (!$isLinkNode(node) && !$isAutoLinkNode(node)) {
            return;
          }
          nextEditing = {
            anchor: target,
            nodeKey: node.getKey(),
            raw: serializeMarkdownLink(node.getTextContent(), node.getURL()),
          };
        });
        const nextEditingValue = nextEditing as EditingLinkState | null;
        if (nextEditingValue !== null) {
          setDraft(nextEditingValue.raw);
          setEditing(nextEditingValue);
        }
      };

      const handleClick = (event: MouseEvent) => {
        const target = resolveLinkElement(event.target);
        if (!target) {
          return;
        }
        const ownerRoot = target.closest<HTMLElement>(".cf-lexical-editor");
        if (ownerRoot !== rootElement) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      };

      detach(previousRootElement);

      if (!rootElement) {
        return;
      }

      rootElement.addEventListener("mousedown", handleMouseDown, true);
      rootElement.addEventListener("click", handleClick, true);
      return () => {
        detach(rootElement);
      };
    });
  }, [editor]);

  const commitDraft = (current: EditingLinkState, nextRaw: string) => {
    editor.update(() => {
      const node = $getNodeByKey(current.nodeKey);
      if (!$isLinkNode(node) && !$isAutoLinkNode(node)) {
        return;
      }

      const parsed = parseMarkdownLink(nextRaw);
      if (!parsed) {
        node.replace($createTextNode(nextRaw));
        return;
      }

      const replacement = $isAutoLinkNode(node)
        ? $createAutoLinkNode(parsed.url)
        : $createLinkNode(parsed.url);
      replacement.append($createTextNode(parsed.text));
      node.replace(replacement);
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });
  };

  if (!editing) {
    return null;
  }

  const inputWidthCh = Math.max(3, draft.length + 1);

  return (
    <SurfaceFloatingPortal anchor={editing.anchor}>
      <EditorChromePanel className="cf-lexical-floating-source-shell cf-lexical-inline-token-panel-shell">
        <EditorChromeBody className="cf-lexical-floating-source-surface cf-lexical-inline-token-panel-surface">
          <EditorChromeInput
            className="cf-lexical-inline-token-source cf-lexical-floating-source-editor cf-lexical-inline-token-panel-editor"
            onBlur={() => {
              commitDraft(editing, draft);
              setEditing(null);
            }}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft(editing, draft);
                setEditing(null);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft(editing.raw);
                setEditing(null);
              }
            }}
            ref={inputRef}
            size={inputWidthCh}
            style={{
              width: `min(calc(100vw - 8px), calc(${inputWidthCh}ch + 0.2rem))`,
            }}
            value={draft}
          />
        </EditorChromeBody>
      </EditorChromePanel>
    </SurfaceFloatingPortal>
  );
}
