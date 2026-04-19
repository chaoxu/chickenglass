import type { AssetPreviewState } from "./media-preview";

type AssetPreviewLayout = "block" | "inline";

interface AssetPreviewViewProps {
  readonly activationProps?: Record<string, unknown>;
  readonly alt: string;
  readonly imageClassName: string;
  readonly layout: AssetPreviewLayout;
  readonly preview: AssetPreviewState;
  readonly src: string;
}

function fallbackLabel(alt: string, src: string): string {
  return alt || src;
}

export function AssetPreviewView({
  activationProps,
  alt,
  imageClassName,
  layout,
  preview,
  src,
}: AssetPreviewViewProps) {
  if (layout === "block") {
    if (preview.kind === "loading") {
      return (
        <div
          className="cf-lexical-media-fallback cf-lexical-media-fallback--loading"
          data-preview-state="loading"
        >
          {`Loading preview: ${src}`}
        </div>
      );
    }

    if (preview.kind === "error" || !preview.previewUrl) {
      return (
        <div
          className="cf-lexical-media-fallback cf-lexical-media-fallback--error"
          data-preview-state="error"
        >
          {`Preview unavailable: ${src}`}
        </div>
      );
    }

    return (
      <div className="cf-lexical-media">
        <img alt={fallbackLabel(alt, src)} className={imageClassName} src={preview.previewUrl} />
      </div>
    );
  }

  if (preview.kind === "loading") {
    return <span className="cf-lexical-inline-image-fallback">{fallbackLabel(alt, src)}</span>;
  }

  if (preview.kind === "error" || !preview.previewUrl) {
    return (
      <span
        className="cf-lexical-inline-image-fallback"
        {...activationProps}
      >
        {fallbackLabel(alt, src)}
      </span>
    );
  }

  return (
    <span
      className="cf-lexical-inline-image-shell"
      {...activationProps}
    >
      <img
        alt={fallbackLabel(alt, src)}
        className={imageClassName}
        src={preview.previewUrl}
      />
    </span>
  );
}
