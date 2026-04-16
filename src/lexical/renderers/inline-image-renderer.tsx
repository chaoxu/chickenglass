import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(raw);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const parsed = useMemo(() => parseMarkdownImage(raw), [raw]);
  const preview = useAssetPreview(parsed?.src ?? "");

  useEffect(() => {
    if (!editing) {
      setDraft(raw);
    }
  }, [editing, raw]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    }
  }, [editing]);

  const commitDraft = useCallback((nextRaw: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      const imageNode = node as { setRaw?: (value: string) => unknown } | null;
      if (imageNode?.setRaw) {
        imageNode.setRaw(nextRaw);
      }
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });
  }, [editor, nodeKey]);

  const inputWidthCh = Math.max(3, draft.length + 1);

  if (editing) {
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

  if (preview.kind === "loading") {
    return <span className="cf-lexical-inline-image-fallback">{parsed.alt || parsed.src}</span>;
  }

  if (preview.kind === "error" || !preview.previewUrl) {
    return (
      <span
        className="cf-lexical-inline-image-fallback"
        {...structureToggleProps(true, () => setEditing(true), { stopPropagation: true })}
      >
        {parsed.alt || parsed.src}
      </span>
    );
  }

  return (
    <span
      className="cf-lexical-inline-image-shell"
      {...structureToggleProps(true, () => setEditing(true), { stopPropagation: true })}
    >
      <img
        alt={parsed.alt || parsed.src}
        className={LEXICAL_NODE_CLASS.INLINE_IMAGE}
        src={preview.previewUrl}
      />
    </span>
  );
});
