import { useMemo, type JSX, type PointerEventHandler, type ReactNode } from "react";

import { SurfaceFloatingPortal } from "../lexical-next";
import { useLexicalRenderContext, type LexicalRenderContextValue } from "./render-context";
import { FigurePreviewBlock } from "./figure-preview-block";
import {
  buildPreviewFencedDivRaw,
} from "./markdown/block-syntax";
import { parseMarkdownImage } from "./markdown/image-markdown";
import { renderCitationTextHtml } from "./markdown/citation-text-html";
import { formatCitationPreview } from "./markdown/reference-display";
import {
  renderDisplayMathHtml,
  renderFencedDivHtml,
  renderMarkdownRichHtml,
} from "./markdown/rich-html-preview";
import { PreviewHtml } from "./preview-html";

export { PreviewHtml } from "./preview-html";

export function FloatingPreviewPortal({
  anchor,
  children,
  onPointerEnter,
}: {
  readonly anchor: HTMLElement;
  readonly children: ReactNode;
  readonly onPointerEnter?: PointerEventHandler<HTMLDivElement>;
}) {
  return (
    <SurfaceFloatingPortal
      anchor={anchor}
      className="cf-hover-preview-tooltip"
      onPointerEnter={onPointerEnter}
      placement="top"
      visible
      zIndex={50}
    >
      {children}
    </SurfaceFloatingPortal>
  );
}

function buildReferencePreview(
  id: string,
  context: LexicalRenderContextValue,
): JSX.Element {
  const citationPreview = formatCitationPreview(id, context.citations);
  if (citationPreview) {
    return (
      <div className="cf-hover-preview">
        <PreviewHtml
          className="cf-hover-preview-body cf-hover-preview-citation"
          html={renderCitationTextHtml(citationPreview, {
            config: context.config,
          })}
        />
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
            <FigurePreviewBlock
              alt={image.alt}
              label={figureLabel}
              src={image.src}
              titleHtml={titleHtml ?? undefined}
            />
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
}

export function createReferencePreviewBuilder(
  context: LexicalRenderContextValue,
): (id: string) => JSX.Element {
  const previewCache = new Map<string, JSX.Element>();

  return (id: string): JSX.Element => {
    const cached = previewCache.get(id);
    if (cached) {
      return cached;
    }

    const preview = buildReferencePreview(id, context);
    previewCache.set(id, preview);
    return preview;
  };
}

function usePreviewBuilder() {
  const context = useLexicalRenderContext();
  return useMemo(() => createReferencePreviewBuilder(context), [context]);
}

export function ReferenceHoverPreviewPortal({
  anchor,
  id,
  onPointerEnter,
}: {
  readonly anchor: HTMLElement;
  readonly id: string;
  readonly onPointerEnter?: PointerEventHandler<HTMLDivElement>;
}) {
  const buildPreview = usePreviewBuilder();
  return (
    <FloatingPreviewPortal anchor={anchor} onPointerEnter={onPointerEnter}>
      {buildPreview(id)}
    </FloatingPreviewPortal>
  );
}
