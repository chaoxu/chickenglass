import { parser as baseParser } from "@lezer/markdown";
import { markdownExtensions } from "../parser";

export const markdownSemanticsParser = baseParser.configure(markdownExtensions);
