import DOMPurify from "dompurify";
import { useMemo } from "react";

export function PreviewHtml({
  className,
  html,
}: {
  readonly className: string;
  readonly html: string;
}) {
  const sanitized = useMemo(() => DOMPurify.sanitize(html), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />;
}
