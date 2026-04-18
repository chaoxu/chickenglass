import { memo, useMemo, useState, type JSX } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { NodeKey } from "lexical";

import { EmbeddedFieldEditor } from "../embedded-field-editor";
import { computeEmbedSrc, embedSandboxPermissions } from "../embed";
import { FigureMedia } from "../figure-media";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";
import { FloatingPreviewPortal, PreviewHtml } from "../hover-preview-plugin";
import { LexicalRichMarkdownEditor } from "../rich-markdown-editor";
import { useIncludedDocument, useLexicalRenderContext } from "../render-context";
import { StructureSourceEditor } from "../structure-source-editor";
import { useStructureEditToggle } from "../structure-edit-plugin";
import { useLexicalSurfaceEditable } from "../editability-context";
import {
  parseStructuredFencedDivRaw,
  serializeFencedDivRaw,
} from "../markdown/block-syntax";
import { getPendingEmbeddedSurfaceFocusId } from "../pending-surface-focus";
import { humanizeBlockType } from "../markdown/block-metadata";
import {
  parseFootnoteDefinition,
  serializeFootnoteDefinition,
} from "../markdown/footnotes";
import { parseMarkdownImage } from "../markdown/image-markdown";
import { renderMarkdownRichHtml } from "../markdown/rich-html-preview";
import { parseFrontmatter } from "../../lib/frontmatter";
import { registerRenderers } from "../nodes/renderer-registry";
import type { RawBlockVariant } from "../nodes/raw-block-node";
import { DisplayMathBlockRenderer } from "./math-renderers";
import { structureToggleProps, useRawBlockUpdater } from "./shared";
import { TableBlockRenderer } from "./table-renderer";

function getFirstLine(raw: string): string {
  return raw.split("\n")[0] ?? "";
}

function replaceFirstLine(raw: string, nextFirstLine: string): string {
  const lines = raw.split("\n");
  lines[0] = nextFirstLine;
  return lines.join("\n");
}

function richHtmlOptions(context: ReturnType<typeof useLexicalRenderContext>) {
  return {
    citations: context.citations,
    config: context.config,
    docPath: context.docPath,
    renderIndex: context.renderIndex,
    resolveAssetUrl: context.resolveAssetUrl,
  };
}

function usePendingEmbeddedSurfaceFocusId(
  nodeKey: NodeKey,
  target: "block-body" | "footnote-body",
): string {
  const [editor] = useLexicalComposerContext();
  return useMemo(
    () => getPendingEmbeddedSurfaceFocusId(editor.getKey(), nodeKey, target),
    [editor, nodeKey, target],
  );
}

function FencedDivStructureSourceEditor({
  nodeKey,
  onClose,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly onClose: () => void;
  readonly raw: string;
}) {
  const updateRaw = useRawBlockUpdater(nodeKey);

  return (
    <div className="cf-lexical-block-source-line">
      <StructureSourceEditor
        className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--opener"
        doc={getFirstLine(raw)}
        namespace={`coflat-block-opener-${nodeKey}`}
        onChange={(nextOpener) => updateRaw(replaceFirstLine(raw, nextOpener))}
        onClose={onClose}
      />
    </div>
  );
}

function FrontmatterRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const [editor] = useLexicalComposerContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const context = useLexicalRenderContext();
  const title = parseFrontmatter(raw).config.title ?? "";
  const updateRaw = useRawBlockUpdater(nodeKey);
  const sourceEdit = useStructureEditToggle(
    nodeKey,
    "frontmatter",
    "frontmatter-source",
  );

  const titleHtml = useMemo(
    () => title ? renderMarkdownRichHtml(title, richHtmlOptions(context)) : "",
    [title, context],
  );

  return (
    <header className={`cf-lexical-title-shell${sourceEdit.active ? " is-editing-source" : ""}`}>
      {sourceEdit.active ? (
        <StructureSourceEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--frontmatter"
          doc={raw}
          multiline
          namespace={`coflat-frontmatter-source-${nodeKey}`}
          onChange={updateRaw}
          onClose={sourceEdit.deactivate}
          pendingFocusId={getPendingEmbeddedSurfaceFocusId(editor.getKey(), nodeKey, "structure-source")}
        />
      ) : (
        <div
          className="cf-lexical-structure-toggle cf-lexical-structure-toggle--frontmatter"
          {...structureToggleProps(surfaceEditable, sourceEdit.activate, {
            keyboardActivation: true,
          })}
        >
          {title ? (
            <div
              className="cf-lexical-nested-editor cf-lexical-nested-editor--frontmatter-title"
              dangerouslySetInnerHTML={{ __html: titleHtml }}
            />
          ) : (
            <h1 className="cf-lexical-frontmatter-title cf-lexical-frontmatter-title--empty">Untitled</h1>
          )}
        </div>
      )}
    </header>
  );
}

function ImageBlockRenderer({
  raw,
}: {
  readonly raw: string;
}) {
  const parsed = useMemo(() => parseMarkdownImage(raw), [raw]);
  if (!parsed) {
    return <div className="cf-lexical-raw-fallback">{raw}</div>;
  }

  return <FigureMedia alt={parsed.alt} src={parsed.src} />;
}

function FootnoteDefinitionBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const { renderIndex } = useLexicalRenderContext();
  const parsed = useMemo(() => parseFootnoteDefinition(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const pendingFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "footnote-body");

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
          onTextChange={(nextBody) => updateRaw(serializeFootnoteDefinition(parsed.id, nextBody))}
          pendingFocusId={pendingFocusId}
        />
      </div>
    </section>
  );
}

function IncludeBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const surfaceEditable = useLexicalSurfaceEditable();
  const parsed = useMemo(() => parseStructuredFencedDivRaw(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const content = useIncludedDocument(parsed.bodyMarkdown.trim());
  const pathEdit = useStructureEditToggle(nodeKey, "fenced-div", "include-path");

  return (
    <section className="cf-lexical-include-shell">
      <div className="cf-lexical-include-meta">
        {surfaceEditable ? (
          <button
            className="cf-lexical-include-path-toggle cf-lexical-structure-toggle cf-lexical-structure-toggle--include"
            type="button"
            {...structureToggleProps(surfaceEditable, pathEdit.activate, {
              keyboardActivation: true,
            })}
          >
            {parsed.bodyMarkdown.trim()}
          </button>
        ) : (
          <span className="cf-lexical-include-path-label">{parsed.bodyMarkdown.trim()}</span>
        )}
      </div>
      {pathEdit.active ? (
        <StructureSourceEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--include"
          doc={parsed.bodyMarkdown.trim()}
          namespace={`coflat-include-path-${nodeKey}`}
          onChange={(nextPath) => updateRaw(serializeFencedDivRaw(parsed, {
            bodyMarkdown: nextPath,
          }))}
          onClose={pathEdit.deactivate}
        />
      ) : null}
      <div className="cf-lexical-include-content">
        {content ? (
          <LexicalRichMarkdownEditor
            doc={content}
            editable={false}
            editorClassName="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--include-preview"
            namespace={`coflat-include-preview-${nodeKey}`}
            showHeadingChrome={false}
            spellCheck={false}
            testId={null}
          />
        ) : (
          <div className="cf-lexical-media-fallback">{`Missing include: ${parsed.bodyMarkdown.trim()}`}</div>
        )}
      </div>
    </section>
  );
}

function CaptionedBlockRenderer({
  label,
  nodeKey,
  parsed,
  raw,
}: {
  readonly label: string;
  readonly nodeKey: NodeKey;
  readonly parsed: ReturnType<typeof parseStructuredFencedDivRaw>;
  readonly raw: string;
}) {
  const surfaceEditable = useLexicalSurfaceEditable();
  const updateRaw = useRawBlockUpdater(nodeKey);
  const openerEdit = useStructureEditToggle(nodeKey, "fenced-div", "block-opener");
  const pendingBodyFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "block-body");

  return (
    <section className={`cf-lexical-block cf-lexical-block--${parsed.blockType} cf-lexical-block--captioned`}>
      {openerEdit.active ? (
        <FencedDivStructureSourceEditor
          nodeKey={nodeKey}
          onClose={openerEdit.deactivate}
          raw={raw}
        />
      ) : null}
      <div className="cf-lexical-block-body">
        <EmbeddedFieldEditor
          className={`cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--${parsed.blockType}-body`}
          doc={parsed.bodyMarkdown}
          family="block-body"
          namespace={`coflat-captioned-block-${nodeKey}`}
          onTextChange={(nextBody) => updateRaw(serializeFencedDivRaw(parsed, {
            bodyMarkdown: nextBody,
          }))}
          pendingFocusId={pendingBodyFocusId}
        />
      </div>
      {parsed.titleMarkdown ? (
        <footer className="cf-lexical-block-caption">
          <span
            className="cf-lexical-block-caption-label cf-lexical-structure-toggle"
            {...structureToggleProps(surfaceEditable, openerEdit.activate)}
          >
            {label}
          </span>
          <div className="cf-lexical-block-caption-text">
            <EmbeddedFieldEditor
              activation="focus"
              className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--caption"
              doc={parsed.titleMarkdown}
              family="caption"
              namespace={`coflat-block-caption-${nodeKey}`}
              onTextChange={(nextTitle) => updateRaw(serializeFencedDivRaw(parsed, {
                bodyMarkdown: parsed.bodyMarkdown,
                titleMarkdown: nextTitle,
              }))}
            />
          </div>
        </footer>
      ) : null}
    </section>
  );
}

function EmbedBlockRenderer({
  label,
  nodeKey,
  parsed,
  raw,
}: {
  readonly label: string;
  readonly nodeKey: NodeKey;
  readonly parsed: ReturnType<typeof parseStructuredFencedDivRaw>;
  readonly raw: string;
}) {
  const surfaceEditable = useLexicalSurfaceEditable();
  const updateRaw = useRawBlockUpdater(nodeKey);
  const openerEdit = useStructureEditToggle(nodeKey, "fenced-div", "block-opener");
  const bodyEdit = useStructureEditToggle(nodeKey, "fenced-div", "embed-url");
  const src = useMemo(
    () => computeEmbedSrc(parsed.blockType, parsed.bodyMarkdown),
    [parsed.blockType, parsed.bodyMarkdown],
  );

  return (
    <section className={`cf-lexical-block cf-lexical-block--embed cf-lexical-block--${parsed.blockType}`}>
      <header className="cf-lexical-block-header">
        <span
          className="cf-lexical-block-label cf-lexical-structure-toggle"
          {...structureToggleProps(surfaceEditable, openerEdit.activate)}
        >
          {label}
        </span>
      </header>
      {openerEdit.active ? (
        <FencedDivStructureSourceEditor
          nodeKey={nodeKey}
          onClose={openerEdit.deactivate}
          raw={raw}
        />
      ) : null}
      <div className="cf-lexical-block-body">
        {bodyEdit.active ? (
          <StructureSourceEditor
            className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--embed"
            doc={parsed.bodyMarkdown.trim()}
            namespace={`coflat-embed-${nodeKey}`}
            onChange={(nextBody) => updateRaw(serializeFencedDivRaw(parsed, {
              bodyMarkdown: nextBody,
            }))}
            onClose={bodyEdit.deactivate}
          />
        ) : src ? (
          <div className="cf-lexical-embed-frame-shell">
            <iframe
              className={parsed.blockType === "youtube"
                ? "cf-lexical-embed-frame cf-lexical-embed-frame--youtube"
                : "cf-lexical-embed-frame"}
              frameBorder="0"
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox={embedSandboxPermissions(parsed.blockType)}
              src={src}
              title={`${label} embed`}
            />
          </div>
        ) : (
          <div className="cf-lexical-media-fallback">{`Invalid embed URL: ${parsed.bodyMarkdown.trim()}`}</div>
        )}
        <a
          className="cf-lexical-embed-link"
          href={parsed.body.trim()}
          onMouseDown={surfaceEditable
            ? (event) => {
                event.preventDefault();
                bodyEdit.activate();
              }
            : undefined}
          rel="noreferrer"
          target="_blank"
        >
          {parsed.body.trim()}
        </a>
      </div>
    </section>
  );
}

function FencedDivBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const surfaceEditable = useLexicalSurfaceEditable();
  const context = useLexicalRenderContext();
  const parsed = useMemo(() => parseStructuredFencedDivRaw(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const openerEdit = useStructureEditToggle(nodeKey, "fenced-div", "block-opener");
  const pendingBodyFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "block-body");
  const referenceEntry = parsed.id ? context.renderIndex.references.get(parsed.id) : undefined;
  const blockOverride = context.config.blocks?.[parsed.blockType];
  const labelOverride = blockOverride && typeof blockOverride === "object"
    ? blockOverride.title
    : undefined;
  const label = referenceEntry?.label ?? labelOverride ?? humanizeBlockType(parsed.blockType);

  if (parsed.blockType === "include") {
    return <IncludeBlockRenderer nodeKey={nodeKey} raw={raw} />;
  }

  if (
    parsed.blockType === "embed"
    || parsed.blockType === "gist"
    || parsed.blockType === "iframe"
    || parsed.blockType === "youtube"
  ) {
    return <EmbedBlockRenderer label={label} nodeKey={nodeKey} parsed={parsed} raw={raw} />;
  }

  if (parsed.blockType === "blockquote") {
    return (
      <blockquote className="cf-lexical-blockquote-shell">
        <EmbeddedFieldEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--blockquote"
          doc={parsed.bodyMarkdown}
          family="block-body"
          namespace={`coflat-blockquote-${nodeKey}`}
          onTextChange={(nextBody) => updateRaw(serializeFencedDivRaw(parsed, {
            bodyMarkdown: nextBody,
          }))}
          pendingFocusId={pendingBodyFocusId}
        />
      </blockquote>
    );
  }

  if (parsed.blockType === "figure" || parsed.blockType === "table") {
    return <CaptionedBlockRenderer label={label} nodeKey={nodeKey} parsed={parsed} raw={raw} />;
  }

  return (
    <section className={`cf-lexical-block cf-lexical-block--${parsed.blockType}`}>
      {openerEdit.active ? (
        <FencedDivStructureSourceEditor
          nodeKey={nodeKey}
          onClose={openerEdit.deactivate}
          raw={raw}
        />
      ) : null}
      <header className="cf-lexical-block-header">
        <span
          className="cf-lexical-block-label cf-lexical-structure-toggle"
          {...structureToggleProps(surfaceEditable, openerEdit.activate)}
        >
          {label}
        </span>
        {parsed.titleMarkdown ? (
          <div className="cf-lexical-block-title">
            <EmbeddedFieldEditor
              activation="focus"
              className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--title"
              doc={parsed.titleMarkdown}
              family="title"
              namespace={`coflat-block-title-${nodeKey}`}
              onTextChange={(nextTitle) => updateRaw(serializeFencedDivRaw(parsed, {
                bodyMarkdown: parsed.bodyMarkdown,
                titleMarkdown: nextTitle,
              }))}
            />
          </div>
        ) : null}
      </header>
      <div className="cf-lexical-block-body">
        <EmbeddedFieldEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--block-body"
          doc={parsed.bodyMarkdown}
          family="block-body"
          namespace={`coflat-block-body-${nodeKey}`}
          onTextChange={(nextBody) => updateRaw(serializeFencedDivRaw(parsed, {
            bodyMarkdown: nextBody,
          }))}
          pendingFocusId={pendingBodyFocusId}
        />
      </div>
    </section>
  );
}

export const FootnoteReferenceRenderer = memo(function FootnoteReferenceRenderer({
  raw,
}: {
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
        <FloatingPreviewPortal anchor={hoverAnchor}>
          <div className="cf-hover-preview">
            <div className="cf-hover-preview-header">{`Footnote ${number ?? "?"}`}</div>
            <PreviewHtml className="cf-hover-preview-body" html={previewHtml} />
          </div>
        </FloatingPreviewPortal>
      ) : null}
    </>
  );
});

// Lexical recreates the decorator React element on every reconciliation pass
// with primitive props (`nodeKey`, `raw`, `variant`). Memoizing skips the
// dispatch logic AND the inner variant component re-render whenever those
// props are unchanged — a major win on docs with hundreds of blocks where a
// single edit otherwise re-renders every decorator.
export const RawBlockRenderer = memo(function RawBlockRenderer({
  nodeKey,
  raw,
  variant,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
  readonly variant: RawBlockVariant;
}) {
  let content: JSX.Element;
  if (variant === "frontmatter") {
    content = <FrontmatterRenderer nodeKey={nodeKey} raw={raw} />;
  } else if (variant === "image") {
    content = <ImageBlockRenderer raw={raw} />;
  } else if (variant === "display-math") {
    content = <DisplayMathBlockRenderer nodeKey={nodeKey} raw={raw} />;
  } else if (variant === "fenced-div") {
    content = <FencedDivBlockRenderer nodeKey={nodeKey} raw={raw} />;
  } else if (variant === "footnote-definition") {
    content = <FootnoteDefinitionBlockRenderer nodeKey={nodeKey} raw={raw} />;
  } else if (variant === "table") {
    content = <TableBlockRenderer nodeKey={nodeKey} raw={raw} />;
  } else {
    content = <div className="cf-lexical-raw-fallback">{raw}</div>;
  }

  return (
    <section
      className={`cf-lexical-raw-block-shell cf-lexical-raw-block-shell--${variant}`}
      data-coflat-raw-block="true"
      data-coflat-raw-block-variant={variant}
    >
      {content}
    </section>
  );
});

// Bind decorator renderers to their node registries at module load time.
// `raw-block-node.ts` and `footnote-reference-node.ts` hold these through
// small registry modules so they never statically reach back into
// `block-renderers.tsx`, which would close the rich-markdown-editor hub cycle.
registerRenderers({
  footnoteReference: FootnoteReferenceRenderer,
  rawBlock: RawBlockRenderer,
});
