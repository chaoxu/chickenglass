import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isCodeNode, CodeHighlightNode, CodeNode } from "@lexical/code";
import {
  $getNodeByKey,
  $isRootNode,
  mergeRegister,
  type EditorState,
  type LexicalNode,
  type NodeKey,
  type NodeMutation,
  TextNode,
} from "lexical";

import {
  useEditorScrollSurface,
  useSurfaceOverlaySync,
  type SurfaceOverlaySync,
  type SurfaceOverlaySyncContext,
  type SurfaceScrollPosition,
} from "./runtime";

const ID_ATTR = "data-coflat-codeblock-id";
const LANGUAGE_ATTR = "data-coflat-codeblock-language";

let nextCodeBlockId = 1;

interface CodeBlockOverlay {
  readonly id: string;
  readonly language: string;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
  };
  readonly text: string;
}

function ensureCodeBlockId(codeElement: HTMLElement): string {
  const existing = codeElement.getAttribute(ID_ATTR);
  if (existing) {
    return existing;
  }
  const nextId = `code-${nextCodeBlockId++}`;
  codeElement.setAttribute(ID_ATTR, nextId);
  return nextId;
}

function formatLanguage(codeElement: HTMLElement): string {
  const language = codeElement.dataset.language?.trim();
  return language ? language.toUpperCase() : "TEXT";
}

function $nodeOrAncestorIsCode(node: LexicalNode | null): boolean {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isCodeNode(current)) {
      return true;
    }
    if ($isRootNode(current)) {
      return false;
    }
    current = current.getParent();
  }
  return false;
}

function textMutationsMayAffectCodeBlocks(
  editorState: EditorState,
  previousEditorState: EditorState,
  mutations: ReadonlyMap<NodeKey, NodeMutation>,
): boolean {
  if (mutations.size === 0) {
    return false;
  }

  let affectsCode = false;
  editorState.read(() => {
    for (const key of mutations.keys()) {
      if ($nodeOrAncestorIsCode($getNodeByKey(key))) {
        affectsCode = true;
        return;
      }
    }
  });

  if (affectsCode) {
    return true;
  }

  previousEditorState.read(() => {
    for (const [key, mutation] of mutations) {
      if (mutation === "destroyed" && $nodeOrAncestorIsCode($getNodeByKey(key))) {
        affectsCode = true;
        return;
      }
    }
  });

  return affectsCode;
}

function sameOverlayGeometry(
  left: readonly CodeBlockOverlay[],
  right: readonly CodeBlockOverlay[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((overlay, index) => {
    const other = right[index];
    return other
      && overlay.id === other.id
      && overlay.language === other.language
      && overlay.text === other.text
      && Math.abs(overlay.rect.left - other.rect.left) < 0.5
      && Math.abs(overlay.rect.top - other.rect.top) < 0.5
      && Math.abs(overlay.rect.width - other.rect.width) < 0.5;
  });
}

export function collectCodeBlockOverlays(
  rootElement: HTMLElement,
  surfaceElement: HTMLElement,
  scrollPosition: SurfaceScrollPosition,
): readonly CodeBlockOverlay[] {
  const overlays: CodeBlockOverlay[] = [];
  const surfaceRect = surfaceElement.getBoundingClientRect();

  for (const codeElement of rootElement.querySelectorAll<HTMLElement>(".cf-lexical-code-block")) {
    const id = ensureCodeBlockId(codeElement);
    codeElement.classList.add("cf-codeblock-body");
    codeElement.setAttribute(LANGUAGE_ATTR, formatLanguage(codeElement));

    const rect = codeElement.getBoundingClientRect();
    overlays.push({
      id,
      language: codeElement.getAttribute(LANGUAGE_ATTR) ?? "TEXT",
      rect: {
        left: rect.left - surfaceRect.left + scrollPosition.left,
        top: rect.top - surfaceRect.top + scrollPosition.top,
        width: rect.width,
      },
      text: codeElement.textContent ?? "",
    });
  }

  return overlays;
}

export function CodeBlockChromePlugin() {
  const [editor] = useLexicalComposerContext();
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
  const [overlays, setOverlays] = useState<readonly CodeBlockOverlay[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const surfaceElement = useEditorScrollSurface();
  const clearOverlays = useCallback(() => {
    setOverlays([]);
  }, []);
  const syncOverlays = useCallback((context: SurfaceOverlaySyncContext) => {
    setOverlays(collectCodeBlockOverlays(
      context.rootElement,
      context.surfaceElement,
      context.scrollPosition,
    ));
  }, []);
  const subscribeOverlayUpdates = useCallback((sync: SurfaceOverlaySync) =>
    mergeRegister(
      editor.registerMutationListener(CodeNode, (mutations) => {
        if (mutations.size > 0) {
          sync();
        }
      }),
      editor.registerMutationListener(TextNode, (mutations, { prevEditorState }) => {
        if (
          textMutationsMayAffectCodeBlocks(
            editor.getEditorState(),
            prevEditorState,
            mutations,
          )
        ) {
          sync();
        }
      }),
      editor.registerMutationListener(CodeHighlightNode, (mutations, { prevEditorState }) => {
        if (
          textMutationsMayAffectCodeBlocks(
            editor.getEditorState(),
            prevEditorState,
            mutations,
          )
        ) {
          sync();
        }
      }),
    ), [editor]);

  useSurfaceOverlaySync({
    observeRootScroll: true,
    onClear: clearOverlays,
    onSync: syncOverlays,
    rootElement,
    subscribe: subscribeOverlayUpdates,
    surfaceElement,
  });

  useEffect(() => editor.registerRootListener((nextRootElement) => {
    setRootElement(nextRootElement);
  }), [editor]);

  useLayoutEffect(() => {
    if (!rootElement || !surfaceElement || overlays.length === 0) {
      return;
    }
    const nextOverlays = collectCodeBlockOverlays(rootElement, surfaceElement, {
      left: surfaceElement.scrollLeft,
      top: surfaceElement.scrollTop,
    });
    if (!sameOverlayGeometry(overlays, nextOverlays)) {
      setOverlays(nextOverlays);
    }
  }, [overlays, rootElement, surfaceElement]);

  const portal = useMemo(() => {
    if (!surfaceElement || typeof document === "undefined") {
      return null;
    }
    return surfaceElement;
  }, [surfaceElement]);

  if (!portal || overlays.length === 0) {
    return null;
  }

  return createPortal(
    overlays.map((overlay) => (
      <div key={overlay.id}>
        <span
          className="cf-codeblock-language"
          data-codeblock-id={overlay.id}
          style={{
            left: `${overlay.rect.left + 16}px`,
            top: `${overlay.rect.top + 6}px`,
            position: "absolute",
          }}
        >
          {overlay.language}
        </span>
        <button
          aria-label={`Copy ${overlay.language.toLowerCase()} code block`}
          className="cf-codeblock-copy"
          data-codeblock-id={overlay.id}
          data-copied={copiedId === overlay.id ? "true" : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void navigator.clipboard.writeText(overlay.text).then(() => {
              setCopiedId(overlay.id);
              window.setTimeout(() => {
                setCopiedId((current) => current === overlay.id ? null : current);
              }, 1200);
            }).catch((error: unknown) => {
              console.error("[code-block] clipboard write failed", error);
            });
          }}
          style={{
            left: `${overlay.rect.left + overlay.rect.width - 54}px`,
            top: `${overlay.rect.top + 2}px`,
            position: "absolute",
          }}
          type="button"
        >
          {copiedId === overlay.id ? "Copied" : "Copy"}
        </button>
      </div>
    )),
    portal,
  );
}
