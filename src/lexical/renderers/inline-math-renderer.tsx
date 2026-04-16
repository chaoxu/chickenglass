import { useMemo, useRef } from "react";
import katex from "katex";
import type { NodeKey } from "lexical";

import { useLexicalRenderContext } from "../render-context";
import { buildKatexOptions } from "../../lib/katex-options";
import { preventKatexMouseDown, useLazyVisibility } from "./shared";
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
  const ref = useRef<HTMLSpanElement | null>(null);
  const visible = useLazyVisibility(ref);
  const body = useMemo(() => stripInlineMathDelimiters(raw), [raw]);
  const html = useMemo(
    () => visible
      ? katex.renderToString(body, buildKatexOptions(false, config.math))
      : null,
    [visible, body, config.math],
  );

  if (html === null) {
    // Reserve a width hint roughly proportional to the source so layout
    // doesn't jump much when KaTeX swaps in. Body length is a conservative
    // upper bound on rendered character count.
    return (
      <span
        className={LEXICAL_NODE_CLASS.INLINE_MATH}
        data-coflat-inline-math-key={nodeKey}
        data-coflat-inline-math-pending=""
        ref={ref}
        style={{ display: "inline-block", minWidth: `${Math.min(body.length, 12)}ch` }}
      >
        {body}
      </span>
    );
  }

  return (
    <span
      className={LEXICAL_NODE_CLASS.INLINE_MATH}
      data-coflat-inline-math-key={nodeKey}
      dangerouslySetInnerHTML={{ __html: html }}
      onMouseDown={preventKatexMouseDown}
      ref={ref}
    />
  );
}
