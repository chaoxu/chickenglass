import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../document-surface-classes";
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
    <section
      className={documentSurfaceClassNames(
        DOCUMENT_SURFACE_CLASS.block,
        "cf-lexical-block cf-lexical-block--figure cf-lexical-block--captioned",
      )}
    >
      <div
        className={documentSurfaceClassNames(
          DOCUMENT_SURFACE_CLASS.blockBody,
          "cf-lexical-block-body",
        )}
      >
        <FigureMedia alt={alt} src={src} />
      </div>
      {titleHtml ? (
        <footer
          className={documentSurfaceClassNames(
            DOCUMENT_SURFACE_CLASS.blockCaption,
            "cf-lexical-block-caption",
          )}
        >
          <span
            className={documentSurfaceClassNames(
              DOCUMENT_SURFACE_CLASS.blockLabel,
              "cf-lexical-block-caption-label",
            )}
          >
            {label}
          </span>
          <PreviewHtml
            className={documentSurfaceClassNames(
              DOCUMENT_SURFACE_CLASS.blockTitle,
              "cf-lexical-block-caption-text",
            )}
            html={titleHtml}
          />
        </footer>
      ) : null}
    </section>
  );
}
