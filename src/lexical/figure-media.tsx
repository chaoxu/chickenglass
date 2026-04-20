import { AssetPreviewView } from "./asset-preview-view";
import { useAssetPreview } from "./media-preview";

export function FigureMedia({
  alt,
  src,
}: {
  readonly alt: string;
  readonly src: string;
}) {
  const preview = useAssetPreview(src);

  return (
    <AssetPreviewView
      alt={alt}
      imageClassName="cf-lexical-image"
      layout="block"
      preview={preview}
      src={src}
    />
  );
}
