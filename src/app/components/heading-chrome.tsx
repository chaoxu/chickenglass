import { renderDocumentFragmentToHtml } from "../../document-surfaces";
import { sanitizeRenderedHtml } from "../../render/inline-shared";

interface HeadingLabelProps {
  /** Raw heading text (without `#` markers or attribute blocks). */
  text: string;
  className?: string;
}

/**
 * Renders heading text through the `chrome-label` surface pipeline.
 *
 * Shared by breadcrumbs and outline so heading labels are rendered
 * identically across all heading chrome UI.
 */
export function HeadingLabel({ text, className }: HeadingLabelProps) {
  const html = sanitizeRenderedHtml(
    renderDocumentFragmentToHtml({ kind: "chrome-label", text }),
  );

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{
        __html: html,
      }}
    />
  );
}
