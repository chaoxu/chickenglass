import type { FrontmatterConfig } from "../lib/frontmatter";
import type { ReferenceCompletionCandidate } from "../state/reference-completion-engine";
import { FigurePreviewBlock } from "./figure-preview-block";
import {
  buildPreviewFencedDivRaw,
} from "./markdown/block-syntax";
import { renderCitationTextHtml } from "./markdown/citation-text-html";
import { parseMarkdownImage } from "./markdown/image-markdown";
import type { RenderCitations } from "./markdown/reference-display";
import type { RenderIndex } from "./markdown/reference-index";
import { renderDisplayMathHtml, renderFencedDivHtml, renderMarkdownRichHtml } from "./markdown/rich-html-preview";
import { PreviewHtml } from "./preview-html";

export interface ReferenceCompletionPreviewRenderOptions {
  readonly citations: RenderCitations;
  readonly config: FrontmatterConfig;
  readonly docPath?: string;
  readonly renderIndex: RenderIndex;
  readonly resolveAssetUrl: (targetPath: string) => string | null;
}

export type ReferenceCompletionPreviewModel =
  | {
    readonly kind: "heading";
    readonly text: string;
  }
  | {
    readonly alt: string;
    readonly kind: "figure";
    readonly label: string;
    readonly src: string;
    readonly titleHtml?: string;
  }
  | {
    readonly html: string;
    readonly kind: "rich-html";
  };

export function buildReferenceCompletionPreviewModel(
  candidate: ReferenceCompletionCandidate,
  options: ReferenceCompletionPreviewRenderOptions,
): ReferenceCompletionPreviewModel | null {
  switch (candidate.previewSource.kind) {
    case "citation":
      return candidate.previewSource.text
        ? {
            html: renderCitationTextHtml(candidate.previewSource.text, options),
            kind: "rich-html",
          }
        : null;
    case "heading":
      return candidate.previewSource.text
        ? { kind: "heading", text: candidate.previewSource.text }
        : null;
    case "equation":
      return {
        html: renderDisplayMathHtml(
          `$$\n${candidate.previewSource.text}\n$$`,
          options,
        ),
        kind: "rich-html",
      };
    case "block":
      if (candidate.previewSource.blockType === "figure") {
        const image = parseMarkdownImage(candidate.previewSource.bodyMarkdown.trim());
        if (image) {
          const titleHtml = candidate.previewSource.title
            ? renderMarkdownRichHtml(candidate.previewSource.title, options)
            : undefined;
          return {
            alt: image.alt,
            kind: "figure",
            label: options.renderIndex.references.get(candidate.id)?.label ?? "Figure",
            src: image.src,
            titleHtml,
          };
        }
      }
      return {
        html: renderFencedDivHtml(buildPreviewFencedDivRaw({
          blockType: candidate.previewSource.blockType,
          bodyMarkdown: candidate.previewSource.bodyMarkdown,
          id: candidate.previewSource.id,
          title: candidate.previewSource.title,
        }), options),
        kind: "rich-html",
      };
  }
}

export function ReferenceCompletionPreview({
  preview,
}: {
  readonly preview: ReferenceCompletionPreviewModel | null;
}) {
  if (!preview) {
    return null;
  }

  if (preview.kind === "heading") {
    return (
      <div className="cf-reference-completion-content">
        <div className="cf-hover-preview-header">{preview.text}</div>
      </div>
    );
  }

  if (preview.kind === "figure") {
    return (
      <div className="cf-reference-completion-content">
        <FigurePreviewBlock
          alt={preview.alt}
          label={preview.label}
          src={preview.src}
          titleHtml={preview.titleHtml}
        />
      </div>
    );
  }

  return (
    <div className="cf-reference-completion-content">
      <PreviewHtml
        className="cf-reference-completion-rich-preview"
        html={preview.html}
      />
    </div>
  );
}
