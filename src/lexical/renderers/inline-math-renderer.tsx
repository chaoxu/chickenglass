import { memo, useCallback, useMemo, useRef } from "react";
import type { MouseEvent } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import katex from "katex";
import type { NodeKey } from "lexical";

import { useLexicalRenderContext } from "../render-context";
import { INLINE_TOKEN_KEY_ATTR } from "../inline-token-boundary";
import { stripInlineMathDelimiters } from "../inline-math-source";
import { inlineMathSourceOffsetFromTarget } from "../math-source-position";
import { OPEN_CURSOR_REVEAL_COMMAND } from "../cursor-reveal-command";
import { buildKatexOptions } from "../../lib/katex-options";
import { useLazyVisibility } from "./shared";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";

// `nodeKey` and `raw` are primitive props that Lexical recreates with stable
// values whenever the underlying node hasn't changed. Memoizing skips the
// KaTeX render check and the placeholder/dangerouslySetInnerHTML JSX rebuild
// every time an unrelated decorator or paragraph re-reconciles.
export const InlineMathRenderer = memo(function InlineMathRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const [editor] = useLexicalComposerContext();
  const { config } = useLexicalRenderContext();
  const ref = useRef<HTMLSpanElement | null>(null);
  const visible = useLazyVisibility(ref);
  const body = useMemo(() => stripInlineMathDelimiters(raw), [raw]);
  const openSourceReveal = useCallback((event: MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const caretOffset = inlineMathSourceOffsetFromTarget(
      event.target,
      raw,
      event.clientX,
    ) ?? raw.length;
    editor.dispatchCommand(OPEN_CURSOR_REVEAL_COMMAND, {
      adapterId: "inline-math",
      caretOffset,
      entry: "pointer",
      nodeKey,
      source: raw,
    });
  }, [editor, nodeKey, raw]);
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
        {...{ [INLINE_TOKEN_KEY_ATTR]: nodeKey }}
        data-coflat-inline-math-key={nodeKey}
        data-coflat-inline-math-pending=""
        onMouseDown={openSourceReveal}
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
      {...{ [INLINE_TOKEN_KEY_ATTR]: nodeKey }}
      data-coflat-inline-math-key={nodeKey}
      dangerouslySetInnerHTML={{ __html: html }}
      onMouseDown={openSourceReveal}
      ref={ref}
    />
  );
});
