import { memo, useMemo, useState, type ComponentType, type JSX } from "react";
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
  fencedDivBodyMarkdownOffset,
  fencedDivTitleMarkdownOffset,
  fencedDivTrimmedBodyMarkdownOffset,
  footnoteDefinitionBodyOffset,
  useEmbeddedMarkdownSourceSelectionBridge,
  useStructureSourceSelectionBridge,
} from "../structure-source-selection";
import {
  parseStructuredFencedDivRaw,
  serializeFencedDivRaw,
} from "../markdown/block-syntax";
import { createFencedDivViewModel } from "../markdown/fenced-div-view-model";
import { getPendingEmbeddedSurfaceFocusId } from "../pending-surface-focus";
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

function getFirstLine(raw: string): string {
  return raw.split("\n")[0] ?? "";
}

function replaceFirstLine(raw: string, nextFirstLine: string): string {
  const lines = raw.split("\n");
  lines[0] = nextFirstLine;
  return lines.join("\n");
}

function updateFencedDivField(
  currentRaw: string,
  overrides: NonNullable<Parameters<typeof serializeFencedDivRaw>[1]>,
): string {
  return serializeFencedDivRaw(parseStructuredFencedDivRaw(currentRaw), overrides);
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
  const [editor] = useLexicalComposerContext();
  const updateRaw = useRawBlockUpdater(nodeKey);
  const onSelectionChange = useStructureSourceSelectionBridge(editor, nodeKey);

  return (
    <div className="cf-lexical-block-source-line">
      <StructureSourceEditor
        className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--opener"
        doc={getFirstLine(raw)}
        namespace={`coflat-block-opener-${nodeKey}`}
        onChange={(nextOpener) => updateRaw((currentRaw) => replaceFirstLine(currentRaw, nextOpener))}
        onClose={onClose}
        onSelectionChange={onSelectionChange}
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
  const onSelectionChange = useStructureSourceSelectionBridge(editor, nodeKey);

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
          onSelectionChange={onSelectionChange}
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

function IncludeBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const surfaceEditable = useLexicalSurfaceEditable();
  const [editor] = useLexicalComposerContext();
  const parsed = useMemo(() => parseStructuredFencedDivRaw(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const pathText = parsed.bodyMarkdown.trim();
  const content = useIncludedDocument(pathText);
  const pathEdit = useStructureEditToggle(nodeKey, "fenced-div", "include-path");
  const onPathSelectionChange = useStructureSourceSelectionBridge(
    editor,
    nodeKey,
    fencedDivTrimmedBodyMarkdownOffset(raw),
  );

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
            {pathText}
          </button>
        ) : (
          <span className="cf-lexical-include-path-label">{pathText}</span>
        )}
      </div>
      {pathEdit.active ? (
        <StructureSourceEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--include"
          doc={pathText}
          namespace={`coflat-include-path-${nodeKey}`}
          onChange={(nextPath) => updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
            bodyMarkdown: nextPath,
          }))}
          onClose={pathEdit.deactivate}
          onSelectionChange={onPathSelectionChange}
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
          <div className="cf-lexical-media-fallback">{`Missing include: ${pathText}`}</div>
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
  const [editor] = useLexicalComposerContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const updateRaw = useRawBlockUpdater(nodeKey);
  const openerEdit = useStructureEditToggle(nodeKey, "fenced-div", "block-opener");
  const pendingBodyFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "block-body");
  const bodyOffset = fencedDivBodyMarkdownOffset(raw);
  const onBodySelectionChange = useEmbeddedMarkdownSourceSelectionBridge(
    editor,
    nodeKey,
    bodyOffset,
  );
  const titleOffset = fencedDivTitleMarkdownOffset(raw, parsed);
  const onTitleSelectionChange = useEmbeddedMarkdownSourceSelectionBridge(
    editor,
    nodeKey,
    titleOffset ?? 0,
  );

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
          onSelectionChange={onBodySelectionChange}
          onTextChange={(nextBody) => updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
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
              onSelectionChange={titleOffset === null ? undefined : onTitleSelectionChange}
              onTextChange={(nextTitle) => updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
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
  const [editor] = useLexicalComposerContext();
  const updateRaw = useRawBlockUpdater(nodeKey);
  const openerEdit = useStructureEditToggle(nodeKey, "fenced-div", "block-opener");
  const bodyEdit = useStructureEditToggle(nodeKey, "fenced-div", "embed-url");
  const bodyText = parsed.bodyMarkdown.trim();
  const src = useMemo(
    () => computeEmbedSrc(parsed.blockType, parsed.bodyMarkdown),
    [parsed.blockType, parsed.bodyMarkdown],
  );
  const onBodySelectionChange = useStructureSourceSelectionBridge(
    editor,
    nodeKey,
    fencedDivTrimmedBodyMarkdownOffset(raw),
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
            doc={bodyText}
            namespace={`coflat-embed-${nodeKey}`}
            onChange={(nextBody) => updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
              bodyMarkdown: nextBody,
            }))}
            onClose={bodyEdit.deactivate}
            onSelectionChange={onBodySelectionChange}
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
  const [editor] = useLexicalComposerContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const context = useLexicalRenderContext();
  const parsed = useMemo(() => parseStructuredFencedDivRaw(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const openerEdit = useStructureEditToggle(nodeKey, "fenced-div", "block-opener");
  const pendingBodyFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "block-body");
  const bodyOffset = fencedDivBodyMarkdownOffset(raw);
  const onBodySelectionChange = useEmbeddedMarkdownSourceSelectionBridge(
    editor,
    nodeKey,
    bodyOffset,
  );
  const titleOffset = fencedDivTitleMarkdownOffset(raw, parsed);
  const onTitleSelectionChange = useEmbeddedMarkdownSourceSelectionBridge(
    editor,
    nodeKey,
    titleOffset ?? 0,
  );
  const referenceLabel = parsed.id ? context.renderIndex.references.get(parsed.id)?.label : undefined;
  const viewModel = useMemo(
    () => createFencedDivViewModel(parsed, {
      config: context.config,
      referenceLabel,
    }),
    [context.config, parsed, referenceLabel],
  );
  const label = viewModel.label;

  if (viewModel.kind === "include") {
    return <IncludeBlockRenderer nodeKey={nodeKey} raw={raw} />;
  }

  if (viewModel.kind === "embed") {
    return <EmbedBlockRenderer label={label} nodeKey={nodeKey} parsed={parsed} raw={raw} />;
  }

  if (viewModel.kind === "blockquote") {
    return (
      <blockquote className="cf-lexical-blockquote-shell">
        <EmbeddedFieldEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--blockquote"
          doc={parsed.bodyMarkdown}
          family="block-body"
          namespace={`coflat-blockquote-${nodeKey}`}
          onSelectionChange={onBodySelectionChange}
          onTextChange={(nextBody) => updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
            bodyMarkdown: nextBody,
          }))}
          pendingFocusId={pendingBodyFocusId}
        />
      </blockquote>
    );
  }

  if (viewModel.kind === "captioned") {
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
              onSelectionChange={titleOffset === null ? undefined : onTitleSelectionChange}
              onTextChange={(nextTitle) => updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
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
          onSelectionChange={onBodySelectionChange}
          onTextChange={(nextBody) => updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
            bodyMarkdown: nextBody,
          }))}
          pendingFocusId={pendingBodyFocusId}
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

interface RawBlockContentRendererProps {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}

function RawFallbackRenderer({ raw }: RawBlockContentRendererProps): JSX.Element {
  return <div className="cf-lexical-raw-fallback">{raw}</div>;
}

const RAW_BLOCK_CONTENT_RENDERERS = {
  "display-math": DisplayMathBlockRenderer,
  "fenced-div": FencedDivBlockRenderer,
  "footnote-definition": FootnoteDefinitionBlockRenderer,
  frontmatter: FrontmatterRenderer,
  image: ImageBlockRenderer,
} satisfies Record<RawBlockVariant, ComponentType<RawBlockContentRendererProps>>;

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
  const ContentRenderer = RAW_BLOCK_CONTENT_RENDERERS[variant] ?? RawFallbackRenderer;

  return (
    <section
      className={`cf-lexical-raw-block-shell cf-lexical-raw-block-shell--${variant}`}
      data-coflat-raw-block="true"
      data-coflat-raw-block-variant={variant}
    >
      <ContentRenderer nodeKey={nodeKey} raw={raw} />
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
