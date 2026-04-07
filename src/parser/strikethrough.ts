import { tags } from "@lezer/highlight";
import { TILDE } from "./char-utils";
import { makeDoubleDelimiterExtension } from "./double-delimiter";

/** Markdown extension that adds ~~strikethrough~~ syntax. */
export const strikethroughExtension = makeDoubleDelimiterExtension({
  name: "Strikethrough",
  delimiter: TILDE,
  rejectTriple: true,
  style: tags.strikethrough,
});
