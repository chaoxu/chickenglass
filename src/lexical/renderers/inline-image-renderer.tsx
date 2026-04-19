import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";

import { useLexicalSurfaceEditable } from "../editability-context";
import { AssetPreviewView } from "../asset-preview-view";
import { EditorChromeInput } from "../editor-chrome";
import { useAssetPreview } from "../media-preview";
import { COFLAT_NESTED_EDIT_TAG } from "../update-tags";
import { parseMarkdownImage } from "../markdown/image-markdown";
import { structureToggleProps } from "./shared";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";

export const InlineImageRenderer = memo(function InlineImageRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const [editor] = useLexicalComposerContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const surfaceEditableRef = useRef(surfaceEditable);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(raw);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const parsed = useMemo(() => parseMarkdownImage(raw), [raw]);
  const preview = useAssetPreview(parsed?.src ?? "");
  surfaceEditableRef.current = surfaceEditable;

  useEffect(() => {
    if (!editing) {
      setDraft(raw);
    }
  }, [editing, raw]);

  useEffect(() => {
    if (!surfaceEditable && editing) {
      setDraft(raw);
      setEditing(false);
      return;
    }

    if (surfaceEditable && editing) {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    }
  }, [editing, raw, surfaceEditable]);

  const commitDraft = useCallback((nextRaw: string) => {
    if (!surfaceEditableRef.current) {
      return;
    }

    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      const imageNode = node as {
        getRaw?: () => string;
        setRaw?: (value: string) => unknown;
      } | null;
      if (imageNode?.setRaw && imageNode.getRaw?.() !== nextRaw) {
        imageNode.setRaw(nextRaw);
      }
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });
  }, [editor, nodeKey]);

  const inputWidthCh = Math.max(3, draft.length + 1);

  if (editing && surfaceEditable) {
    return (
      <EditorChromeInput
        className="cf-lexical-inline-token-source h-auto w-auto font-mono text-[13px]"
        onBlur={() => {
          commitDraft(draft);
          setEditing(false);
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft(draft);
            setEditing(false);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(raw);
            setEditing(false);
          }
        }}
        ref={inputRef}
        size={inputWidthCh}
        style={{
          width: `min(calc(100vw - 8px), calc(${inputWidthCh}ch + 0.2rem))`,
        }}
        value={draft}
      />
    );
  }

  if (!parsed) {
    return <span className="cf-lexical-raw-fallback">{raw}</span>;
  }

  return (
    <AssetPreviewView
      activationProps={structureToggleProps(surfaceEditable, () => setEditing(true), {
        stopPropagation: true,
      })}
      alt={parsed.alt}
      imageClassName={LEXICAL_NODE_CLASS.INLINE_IMAGE}
      layout="inline"
      preview={preview}
      src={parsed.src}
    />
  );
});
