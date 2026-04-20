import { memo, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { NodeKey } from "lexical";

import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";
import { EmbeddedFieldEditor } from "../embedded-field-editor";
import { FloatingPreviewPortal, PreviewHtml } from "../hover-preview-plugin";
import {
  parseFootnoteDefinition,
  serializeFootnoteDefinition,
} from "../markdown/footnotes";
import { renderMarkdownRichHtml } from "../markdown/rich-html-preview";
import { useLexicalRenderContext } from "../render-context";
import {
  footnoteDefinitionBodyOffset,
  useEmbeddedMarkdownSourceSelectionBridge,
} from "../structure-source-selection";
import {
  usePendingEmbeddedSurfaceFocusId,
  useRawBlockUpdater,
} from "./shared";

export function FootnoteDefinitionBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const [editor] = useLexicalComposerContext();
  const { renderIndex } = useLexicalRenderContext();
  const parsed = useMemo(() => parseFootnoteDefinition(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const pendingFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "footnote-body");
  const bodyOffset = footnoteDefinitionBodyOffset(raw);
  const onBodySelectionChange = useEmbeddedMarkdownSourceSelectionBridge(
    editor,
    nodeKey,
    bodyOffset,
  );

  if (!parsed) {
    return <div className="cf-lexical-raw-fallback">{raw}</div>;
  }

  const number = renderIndex.footnotes.get(parsed.id) ?? "?";

  return (
    <section className="cf-lexical-footnote-definition">
      <div className="cf-lexical-footnote-definition-label">{number}.</div>
      <div className="cf-lexical-footnote-definition-body">
        <EmbeddedFieldEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--footnote"
          doc={parsed.body}
          family="footnote-body"
          namespace={`coflat-footnote-${nodeKey}`}
          onSelectionChange={onBodySelectionChange}
          onTextChange={(nextBody) => updateRaw(serializeFootnoteDefinition(parsed.id, nextBody))}
          pendingFocusId={pendingFocusId}
        />
      </div>
    </section>
  );
}

export const FootnoteReferenceRenderer = memo(function FootnoteReferenceRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: string;
  readonly raw: string;
}) {
  const context = useLexicalRenderContext();
  const id = raw.match(/^\[\^([^\]]+)\]$/)?.[1];
  const number = id ? context.renderIndex.footnotes.get(id) : undefined;
  const body = id ? context.footnoteDefinitions.get(id) : undefined;
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const previewHtml = useMemo(() => {
    if (!body) {
      return null;
    }
    return renderMarkdownRichHtml(body, {
      citations: context.citations,
      config: context.config,
      docPath: context.docPath,
      renderIndex: context.renderIndex,
      resolveAssetUrl: context.resolveAssetUrl,
    });
  }, [body, context]);

  return (
    <>
      <sup
        className={LEXICAL_NODE_CLASS.FOOTNOTE_REFERENCE}
        data-coflat-inline-token-key={nodeKey}
        data-footnote-id={id}
        onMouseEnter={(event) => {
          if (body) {
            setHoverAnchor(event.currentTarget);
          }
        }}
        onMouseLeave={() => setHoverAnchor(null)}
      >
        {number ?? "?"}
      </sup>
      {hoverAnchor && previewHtml ? (
        <FloatingPreviewPortal
          anchor={hoverAnchor}
          onPointerEnter={() => setHoverAnchor(null)}
        >
          <div className="cf-hover-preview">
            <div className="cf-hover-preview-header">{`Footnote ${number ?? "?"}`}</div>
            <PreviewHtml className="cf-hover-preview-body" html={previewHtml} />
          </div>
        </FloatingPreviewPortal>
      ) : null}
    </>
  );
});
