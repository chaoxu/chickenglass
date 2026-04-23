import { CSS } from "../constants/css-classes";
import { SimpleTextReferenceWidget } from "./render-core";

/**
 * Widget that renders a citation reference.
 *
 * Handles both parenthetical citations like "(Karger, 2000)" and narrative
 * citations like "Karger (2000)". Pass `narrative: true` for the latter.
 */
export class CitationWidget extends SimpleTextReferenceWidget {
  constructor(
    text: string,
    ids: readonly string[],
    narrative: boolean = false,
  ) {
    super({
      className: narrative ? CSS.citationNarrative : CSS.citation,
      text,
      ariaLabel: ids.join("; "),
    });
  }
}
