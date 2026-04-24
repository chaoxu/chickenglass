import { AssetPreviewView } from "./asset-preview-view";
import { useAssetPreview } from "./media-preview";

export function FigureMedia({
  activationProps,
  alt,
  src,
}: {
  readonly activationProps?: Record<string, unknown>;
  readonly alt: string;
  readonly src: string;
}) {
  const preview = useAssetPreview(src);

  return (
    <AssetPreviewView
      activationProps={activationProps}
      alt={alt}
      imageClassName="cf-lexical-image"
      layout="block"
      preview={preview}
      src={src}
    />
  );
}
