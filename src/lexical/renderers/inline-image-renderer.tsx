import { memo, useCallback, useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { NodeKey } from "lexical";

import { useLexicalSurfaceEditable } from "../editability-context";
import { AssetPreviewView } from "../asset-preview-view";
import { useAssetPreview } from "../media-preview";
import { INLINE_TOKEN_KEY_ATTR } from "../inline-token-boundary";
import { parseMarkdownImage } from "../markdown/image-markdown";
import { structureToggleProps } from "./shared";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";
import { OPEN_CURSOR_REVEAL_COMMAND } from "../cursor-reveal-command";

export const InlineImageRenderer = memo(function InlineImageRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const [editor] = useLexicalComposerContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const parsed = useMemo(() => parseMarkdownImage(raw), [raw]);
  const preview = useAssetPreview(parsed?.src ?? "");

  const openSourceReveal = useCallback(() => {
    if (!surfaceEditable) {
      return;
    }
    editor.dispatchCommand(OPEN_CURSOR_REVEAL_COMMAND, {
      adapterId: "inline-image",
      caretOffset: raw.length,
      entry: "pointer",
      nodeKey,
      source: raw,
    });
  }, [editor, nodeKey, raw, surfaceEditable]);

  if (!parsed) {
    return <span className="cf-lexical-raw-fallback">{raw}</span>;
  }

  return (
    <span {...{ [INLINE_TOKEN_KEY_ATTR]: nodeKey }}>
      <AssetPreviewView
        activationProps={structureToggleProps(surfaceEditable, openSourceReveal, {
          stopPropagation: true,
        })}
        alt={parsed.alt}
        imageClassName={LEXICAL_NODE_CLASS.INLINE_IMAGE}
        layout="inline"
        preview={preview}
        src={parsed.src}
      />
    </span>
  );
});
