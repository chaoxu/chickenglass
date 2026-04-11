import DOMPurify from "dompurify";
import { useMemo } from "react";
import type { FrontmatterConfig } from "../lib/frontmatter";
import type { ReferenceCompletionCandidate } from "../state/reference-completion-engine";
import {
  buildPreviewFencedDivRaw,
  type RenderCitations,
  type RenderIndex,
  renderDisplayMathHtml,
  renderFencedDivHtml,
} from "./rendering";

export interface ReferenceCompletionPreviewRenderOptions {
  readonly citations: RenderCitations;
  readonly config: FrontmatterConfig;
  readonly docPath?: string;
  readonly renderIndex: RenderIndex;
  readonly resolveAssetUrl: (targetPath: string) => string | null;
}

export type ReferenceCompletionPreviewModel =
  | {
    readonly kind: "citation";
    readonly text: string;
  }
  | {
    readonly kind: "heading";
    readonly text: string;
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
        ? { kind: "citation", text: candidate.previewSource.text }
        : null;
    case "heading":
      return candidate.previewSource.text
        ? { kind: "heading", text: candidate.previewSource.text }
        : null;
    case "equation":
      return {
        html: renderDisplayMathHtml(
          `$$\n${candidate.previewSource.text}\n$$${candidate.previewSource.id ? ` {#${candidate.previewSource.id}}` : ""}`,
          options,
        ),
        kind: "rich-html",
      };
    case "block":
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

function ReferenceCompletionPreviewHtml({
  className,
  html,
}: {
  readonly className: string;
  readonly html: string;
}) {
  const sanitized = useMemo(() => DOMPurify.sanitize(html), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

export function ReferenceCompletionPreview({
  preview,
}: {
  readonly preview: ReferenceCompletionPreviewModel | null;
}) {
  if (!preview) {
    return null;
  }

  if (preview.kind === "citation") {
    return <div className="cf-citation-preview">{preview.text}</div>;
  }

  if (preview.kind === "heading") {
    return (
      <div className="cf-reference-completion-content">
        <div className="cf-hover-preview-header">{preview.text}</div>
      </div>
    );
  }

  return (
    <div className="cf-reference-completion-content">
      <ReferenceCompletionPreviewHtml
        className="cf-reference-completion-rich-preview"
        html={preview.html}
      />
    </div>
  );
}
