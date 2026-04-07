import { tags } from "@lezer/highlight";
import { EQUALS } from "./char-utils";
import { makeDoubleDelimiterExtension } from "./double-delimiter";

/** Markdown extension that adds ==highlight== syntax. */
export const highlightExtension = makeDoubleDelimiterExtension({
  name: "Highlight",
  delimiter: EQUALS,
  rejectTriple: false,
  style: tags.special(tags.content),
});
