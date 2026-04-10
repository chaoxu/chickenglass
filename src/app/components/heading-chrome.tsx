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
  return <span className={className}>{text}</span>;
}
