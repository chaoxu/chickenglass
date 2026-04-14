import { useMemo } from "react";
import katex from "katex";
import type { NodeKey } from "lexical";

import { useLexicalRenderContext } from "../render-context";
import { buildKatexOptions } from "../../lib/katex-options";
import { preventKatexMouseDown } from "./shared";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";

function stripInlineMathDelimiters(raw: string): string {
  if (raw.startsWith("\\(") && raw.endsWith("\\)")) {
    return raw.slice(2, -2);
  }
  if (raw.startsWith("$") && raw.endsWith("$")) {
    return raw.slice(1, -1);
  }
  return raw;
}

export function InlineMathRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const { config } = useLexicalRenderContext();
  const body = useMemo(() => stripInlineMathDelimiters(raw), [raw]);
  const html = useMemo(
    () => katex.renderToString(body, buildKatexOptions(false, config.math)),
    [body, config.math],
  );

  return (
    <span
      className={LEXICAL_NODE_CLASS.INLINE_MATH}
      data-coflat-inline-math-key={nodeKey}
      dangerouslySetInnerHTML={{ __html: html }}
      onMouseDown={preventKatexMouseDown}
    />
  );
}
