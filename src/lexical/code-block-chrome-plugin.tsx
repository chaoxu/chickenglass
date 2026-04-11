import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "lexical";

import { useEditorScrollSurface } from "../lexical-next";

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

interface ScrollPosition {
  readonly left: number;
  readonly top: number;
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

export function collectCodeBlockOverlays(
  rootElement: HTMLElement,
  surfaceElement: HTMLElement,
  scrollPosition: ScrollPosition,
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
  const scrollPositionRef = useRef<ScrollPosition>({ left: 0, top: 0 });

  useEffect(() => {
    let raf = 0;
    let timeout = 0;

    const sync = () => {
      if (!rootElement || !surfaceElement) {
        setOverlays([]);
        return;
      }

      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);

      const commit = () => {
        if (!rootElement || !surfaceElement) {
          setOverlays([]);
          return;
        }
        setOverlays(collectCodeBlockOverlays(rootElement, surfaceElement, scrollPositionRef.current));
      };

      raf = requestAnimationFrame(commit);
      timeout = window.setTimeout(commit, 120);
    };

    if (!rootElement || !surfaceElement) {
      setOverlays([]);
      return undefined;
    }

    const syncScrollPosition = () => {
      scrollPositionRef.current = {
        left: surfaceElement.scrollLeft,
        top: surfaceElement.scrollTop,
      };
      sync();
    };

    syncScrollPosition();
    surfaceElement.addEventListener("scroll", syncScrollPosition, { passive: true });
    if (surfaceElement !== rootElement) {
      rootElement.addEventListener("scroll", syncScrollPosition, { passive: true });
    }
    window.addEventListener("resize", sync);

    return mergeRegister(
      editor.registerUpdateListener(() => {
        sync();
      }),
      () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(timeout);
        surfaceElement.removeEventListener("scroll", syncScrollPosition);
        if (surfaceElement !== rootElement) {
          rootElement.removeEventListener("scroll", syncScrollPosition);
        }
        window.removeEventListener("resize", sync);
      },
    );
  }, [editor, rootElement, surfaceElement]);

  useEffect(() => editor.registerRootListener((nextRootElement) => {
    setRootElement(nextRootElement);
  }), [editor]);

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
