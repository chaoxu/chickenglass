import type {
  InlineContext,
  InlineParser,
  MarkdownConfig,
  NodeSpec,
} from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import { scanDoubleDelimited } from "./char-utils";

interface DoubleDelimiterExtensionConfig {
  readonly name: string;
  readonly delimiter: number;
  readonly rejectTriple: boolean;
  readonly style: NodeSpec["style"];
}

/**
 * Build an inline extension for paired double-character delimiters such as
 * `==...==` and `~~...~~`.
 */
export function makeDoubleDelimiterExtension(
  config: DoubleDelimiterExtensionConfig,
): MarkdownConfig {
  const markName = `${config.name}Mark`;
  const parser: InlineParser = {
    name: config.name,
    parse(cx: InlineContext, next: number, pos: number): number {
      if (next !== config.delimiter) return -1;

      const match = scanDoubleDelimited(
        cx,
        pos,
        config.delimiter,
        config.rejectTriple,
      );
      if (!match) return -1;

      const openMark = cx.elt(markName, pos, pos + 2);
      const closeMark = cx.elt(markName, match.closeStart, match.closeEnd);
      return cx.addElement(
        cx.elt(config.name, pos, match.closeEnd, [openMark, closeMark]),
      );
    },
    before: "Escape",
  };

  return {
    defineNodes: [
      {
        name: config.name,
        style: config.style,
      },
      {
        name: markName,
        style: tags.processingInstruction,
      },
    ],
    parseInline: [parser],
  };
}
