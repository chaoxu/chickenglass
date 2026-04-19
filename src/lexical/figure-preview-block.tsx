import { FigureMedia } from "./figure-media";
import { PreviewHtml } from "./preview-html";

export function FigurePreviewBlock({
  alt,
  label,
  src,
  titleHtml,
}: {
  readonly alt: string;
  readonly label: string;
  readonly src: string;
  readonly titleHtml?: string;
}) {
  return (
    <section className="cf-lexical-block cf-lexical-block--figure cf-lexical-block--captioned">
      <div className="cf-lexical-block-body">
        <FigureMedia alt={alt} src={src} />
      </div>
      {titleHtml ? (
        <footer className="cf-lexical-block-caption">
          <span className="cf-lexical-block-caption-label">{label}</span>
          <PreviewHtml
            className="cf-lexical-block-caption-text"
            html={titleHtml}
          />
        </footer>
      ) : null}
    </section>
  );
}
