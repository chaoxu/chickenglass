import { useAssetPreview } from "./media-preview";

export function FigureMedia({
  alt,
  src,
}: {
  readonly alt: string;
  readonly src: string;
}) {
  const preview = useAssetPreview(src);

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
      <img alt={alt || src} className="cf-lexical-image" src={preview.previewUrl} />
    </div>
  );
}
