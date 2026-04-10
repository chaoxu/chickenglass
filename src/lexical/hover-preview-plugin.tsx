import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import DOMPurify from "dompurify";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";

import { useLexicalRenderContext } from "./render-context";
import { FigureMedia } from "./figure-media";
import {
  buildPreviewFencedDivRaw,
  formatCitationPreview,
  parseMarkdownImage,
  renderDisplayMathHtml,
  renderFencedDivHtml,
  renderMarkdownRichHtml,
} from "./rendering";

interface PreviewState {
  readonly anchor: HTMLElement;
  readonly content: JSX.Element;
  readonly key: string;
}

const HOVER_DELAY_MS = 300;

export function PreviewHtml({
  className,
  html,
}: {
  readonly className: string;
  readonly html: string;
}) {
  const sanitized = useMemo(() => DOMPurify.sanitize(html), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

export function FloatingPreviewPortal({
  anchor,
  children,
}: {
  readonly anchor: HTMLElement;
  readonly children: ReactNode;
}) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) {
      return;
    }

    return autoUpdate(anchor, tooltip, () => {
      void computePosition(anchor, tooltip, {
        placement: "top",
        middleware: [offset(6), flip(), shift({ padding: 5 })],
      }).then(({ x, y }) => {
        Object.assign(tooltip.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    });
  }, [anchor]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="cf-hover-preview-tooltip"
      data-visible="true"
      ref={tooltipRef}
      style={{ display: "block", position: "fixed" }}
    >
      {children}
    </div>,
    document.body,
  );
}

function usePreviewBuilder() {
  const context = useLexicalRenderContext();

  return useMemo(() => {
    return (id: string): JSX.Element => {
      const citationPreview = formatCitationPreview(id, context.citations);
      if (citationPreview) {
        return (
          <div className="cf-hover-preview">
            <div className="cf-hover-preview-body cf-hover-preview-citation">{citationPreview}</div>
          </div>
        );
      }

      const definition = context.labelGraph.uniqueDefinitionById.get(id);
      if (!definition) {
        return (
          <div className="cf-hover-preview">
            <div className="cf-hover-preview-header cf-hover-preview-unresolved">{`Unresolved: ${id}`}</div>
          </div>
        );
      }

      if (definition.kind === "equation" && definition.text) {
        const raw = `$$\n${definition.text}\n$$${definition.id ? ` {#${definition.id}}` : ""}`;
        return (
          <div className="cf-hover-preview">
            <PreviewHtml
              className="cf-hover-preview-body"
              html={renderDisplayMathHtml(raw, {
                citations: context.citations,
                config: context.config,
                docPath: context.docPath,
                renderIndex: context.renderIndex,
                resolveAssetUrl: context.resolveAssetUrl,
              })}
            />
          </div>
        );
      }

      if (definition.kind === "block" && definition.content != null) {
        if (definition.blockType === "figure") {
          const image = parseMarkdownImage(definition.content.trim());
          if (image) {
            const figureLabel = context.renderIndex.references.get(id)?.label ?? "Figure";
            const titleHtml = definition.title
              ? renderMarkdownRichHtml(definition.title, {
                citations: context.citations,
                config: context.config,
                docPath: context.docPath,
                renderIndex: context.renderIndex,
                resolveAssetUrl: context.resolveAssetUrl,
              })
              : null;
            return (
              <div className="cf-hover-preview">
                <section className="cf-lexical-block cf-lexical-block--figure cf-lexical-block--captioned">
                  <div className="cf-lexical-block-body">
                    <FigureMedia alt={image.alt} src={image.src} />
                  </div>
                  {titleHtml ? (
                    <footer className="cf-lexical-block-caption">
                      <span className="cf-lexical-block-caption-label">{`${figureLabel}.`}</span>
                      <PreviewHtml
                        className="cf-lexical-block-caption-text"
                        html={titleHtml}
                      />
                    </footer>
                  ) : null}
                </section>
              </div>
            );
          }
        }

        const raw = buildPreviewFencedDivRaw({
          blockType: definition.blockType,
          bodyMarkdown: definition.content,
          id: definition.id,
          title: definition.title,
        });
        return (
          <div className="cf-hover-preview">
            <PreviewHtml
              className="cf-hover-preview-body"
              html={renderFencedDivHtml(raw, {
                citations: context.citations,
                config: context.config,
                docPath: context.docPath,
                renderIndex: context.renderIndex,
                resolveAssetUrl: context.resolveAssetUrl,
              })}
            />
          </div>
        );
      }

      if (definition.kind === "heading") {
        const label = context.renderIndex.references.get(id)?.label ?? definition.text ?? id;
        return (
          <div className="cf-hover-preview">
            <div className="cf-hover-preview-header">{label}</div>
          </div>
        );
      }

      return (
        <div className="cf-hover-preview">
          <div className="cf-hover-preview-header cf-hover-preview-unresolved">{`Unresolved: ${id}`}</div>
        </div>
      );
    };
  }, [context]);
}

export function ReferenceHoverPreviewPortal({
  anchor,
  id,
}: {
  readonly anchor: HTMLElement;
  readonly id: string;
}) {
  const buildPreview = usePreviewBuilder();
  return (
    <FloatingPreviewPortal anchor={anchor}>
      {buildPreview(id)}
    </FloatingPreviewPortal>
  );
}

export function CitationAnchorPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const assignAnchors = () => {
      const root = editor.getRootElement();
      if (!root) {
        return;
      }

      const citations = [...root.querySelectorAll<HTMLElement>("[data-coflat-citation='true']")];
      citations.forEach((element, index) => {
        element.id = `cite-ref-${index + 1}`;
      });
    };

    assignAnchors();
    queueMicrotask(assignAnchors);
    requestAnimationFrame(assignAnchors);
    const unregisterUpdate = editor.registerUpdateListener(() => {
      queueMicrotask(assignAnchors);
      requestAnimationFrame(assignAnchors);
    });
    const unregisterRoot = editor.registerRootListener((rootElement) => {
      if (rootElement) {
        queueMicrotask(assignAnchors);
        requestAnimationFrame(assignAnchors);
      }
    });

    return () => {
      unregisterRoot();
      unregisterUpdate();
    };
  }, [editor]);

  return null;
}

export function HoverPreviewPlugin() {
  const [editor] = useLexicalComposerContext();
  const buildPreview = usePreviewBuilder();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupPositionRef = useRef<(() => void) | null>(null);
  const rootHandlersRef = useRef(new WeakMap<HTMLElement, {
    readonly mouseOut: (event: MouseEvent) => void;
    readonly mouseOver: (event: Event) => void;
  }>());

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
      cleanupPositionRef.current?.();
    };
  }, []);

  useEffect(() => {
    const tooltip = tooltipRef.current;
    if (!preview || !tooltip) {
      cleanupPositionRef.current?.();
      cleanupPositionRef.current = null;
      return;
    }

    cleanupPositionRef.current?.();
    cleanupPositionRef.current = autoUpdate(preview.anchor, tooltip, () => {
      void computePosition(preview.anchor, tooltip, {
        placement: "top",
        middleware: [offset(6), flip(), shift({ padding: 5 })],
      }).then(({ x, y }) => {
        Object.assign(tooltip.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    });

    return () => {
      cleanupPositionRef.current?.();
      cleanupPositionRef.current = null;
    };
  }, [preview]);

  useEffect(() => {
    const clearHoverTimer = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };

    const resolveTarget = (target: EventTarget | null): { anchor: HTMLElement; id: string; key: string } | null => {
      const element = target instanceof HTMLElement
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
      if (!element) {
        return null;
      }

      const item = element.closest<HTMLElement>("[data-coflat-ref-id]");
      if (item) {
        const id = item.dataset.coflatRefId;
        if (id) {
          return {
            anchor: item,
            id,
            key: `item:${id}`,
          };
        }
      }

      const singleReference = element.closest<HTMLElement>("[data-coflat-single-ref-id]");
      if (singleReference) {
        const id = singleReference.dataset.coflatSingleRefId;
        if (id) {
          return {
            anchor: singleReference,
            id,
            key: `single:${id}`,
          };
        }
      }

      return null;
    };

    return editor.registerRootListener((rootElement, previousRootElement) => {
      if (previousRootElement) {
        const previousHandlers = rootHandlersRef.current.get(previousRootElement);
        if (previousHandlers) {
          previousRootElement.removeEventListener("mouseover", previousHandlers.mouseOver);
          previousRootElement.removeEventListener("mouseout", previousHandlers.mouseOut);
          rootHandlersRef.current.delete(previousRootElement);
        }
      }

      if (!rootElement) {
        return;
      }

      const onMouseOver = (event: Event) => {
        const target = resolveTarget(event.target);
        if (!target) {
          clearHoverTimer();
          setPreview(null);
          return;
        }

        if (preview?.key === target.key && preview.anchor === target.anchor) {
          return;
        }

        clearHoverTimer();
        hoverTimerRef.current = setTimeout(() => {
          setPreview({
            anchor: target.anchor,
            content: buildPreview(target.id),
            key: target.key,
          });
        }, HOVER_DELAY_MS);
      };

      const onMouseOut = (event: MouseEvent) => {
        const relatedTarget = event.relatedTarget;
        if (resolveTarget(relatedTarget)) {
          return;
        }
        clearHoverTimer();
        setPreview(null);
      };

      rootElement.addEventListener("mouseover", onMouseOver);
      rootElement.addEventListener("mouseout", onMouseOut);
      rootHandlersRef.current.set(rootElement, {
        mouseOut: onMouseOut,
        mouseOver: onMouseOver,
      });
    });
  }, [buildPreview, editor, preview]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="cf-hover-preview-tooltip"
      data-visible={preview ? "true" : "false"}
      ref={tooltipRef}
      style={{ display: preview ? "block" : "none", position: "fixed" }}
    >
      {preview?.content ?? null}
    </div>,
    document.body,
  );
}
