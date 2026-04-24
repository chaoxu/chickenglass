import { useCallback, useMemo, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { NodeKey } from "lexical";

import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../../document-surface-classes";
import { readVisibleTextDomSelection } from "../dom-selection";
import { EmbeddedFieldEditor } from "../embedded-field-editor";
import { createFencedDivViewModel } from "../markdown/fenced-div-view-model";
import { parseStructuredFencedDivRaw } from "../markdown/block-syntax";
import { useLexicalRenderContext } from "../render-context";
import { StructureSourceEditor } from "../structure-source-editor";
import { useStructureEditToggle } from "../structure-edit-plugin";
import {
  fencedDivBodyMarkdownOffset,
  fencedDivTitleMarkdownOffset,
  useEmbeddedMarkdownSourceSelectionBridge,
  useStructureSourceSelectionBridge,
} from "../structure-source-selection";
import { useLexicalSurfaceEditable } from "../editability-context";
import {
  getFirstLine,
  replaceFirstLine,
  updateFencedDivField,
} from "./fenced-div-field";
import {
  structureToggleProps,
  usePendingEmbeddedSurfaceFocusId,
  useRawBlockUpdater,
} from "./shared";

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
  const pendingCaptionFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "block-caption");
  const captionShellRef = useRef<HTMLDivElement | null>(null);
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
  const publishCaptionSelection = useCallback((nextTitle: string) => {
    const root = captionShellRef.current?.querySelector<HTMLElement>("[contenteditable='true']") ?? null;
    const visibleSelection = readVisibleTextDomSelection(root);
    if (visibleSelection) {
      onTitleSelectionChange(visibleSelection, nextTitle);
    }
  }, [onTitleSelectionChange]);

  return (
    <section
      className={documentSurfaceClassNames(
        DOCUMENT_SURFACE_CLASS.block,
        `cf-lexical-block cf-lexical-block--${parsed.blockType} cf-lexical-block--captioned`,
      )}
    >
      {openerEdit.active ? (
        <FencedDivStructureSourceEditor
          nodeKey={nodeKey}
          onClose={openerEdit.deactivate}
          raw={raw}
        />
      ) : null}
      <div
        className={documentSurfaceClassNames(
          DOCUMENT_SURFACE_CLASS.blockBody,
          "cf-lexical-block-body",
        )}
      >
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
        <footer
          className={documentSurfaceClassNames(
            DOCUMENT_SURFACE_CLASS.blockCaption,
            "cf-lexical-block-caption",
          )}
        >
          <span
            className={documentSurfaceClassNames(
              DOCUMENT_SURFACE_CLASS.blockLabel,
              "cf-lexical-block-caption-label cf-lexical-structure-toggle",
            )}
            {...structureToggleProps(surfaceEditable, openerEdit.activate)}
          >
            {label}
          </span>
          <div
            className={documentSurfaceClassNames(
              DOCUMENT_SURFACE_CLASS.blockTitle,
              "cf-lexical-block-caption-text",
            )}
            ref={captionShellRef}
          >
            <EmbeddedFieldEditor
              activation="focus"
              className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--caption"
              doc={parsed.titleMarkdown}
              family="caption"
              namespace={`coflat-block-caption-${nodeKey}`}
              onSelectionChange={titleOffset === null ? undefined : onTitleSelectionChange}
              onTextChange={(nextTitle) => {
                publishCaptionSelection(nextTitle);
                updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
                  titleMarkdown: nextTitle,
                }));
                queueMicrotask(() => publishCaptionSelection(nextTitle));
                requestAnimationFrame(() => publishCaptionSelection(nextTitle));
                setTimeout(() => publishCaptionSelection(nextTitle), 0);
                setTimeout(() => publishCaptionSelection(nextTitle), 100);
              }}
              pendingFocusId={pendingCaptionFocusId}
            />
          </div>
        </footer>
      ) : null}
    </section>
  );
}

export function FencedDivBlockRenderer({
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
  const titleShellRef = useRef<HTMLDivElement | null>(null);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const openerEdit = useStructureEditToggle(nodeKey, "fenced-div", "block-opener");
  const pendingBodyFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "block-body");
  const pendingTitleFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "block-title");
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
  const publishTitleSelection = useCallback((nextTitle: string) => {
    const root = titleShellRef.current?.querySelector<HTMLElement>("[contenteditable='true']") ?? null;
    const visibleSelection = readVisibleTextDomSelection(root);
    if (visibleSelection) {
      onTitleSelectionChange(visibleSelection, nextTitle);
    }
  }, [onTitleSelectionChange]);
  const referenceLabel = parsed.id ? context.renderIndex.references.get(parsed.id)?.label : undefined;
  const viewModel = useMemo(
    () => createFencedDivViewModel(parsed, {
      config: context.config,
      referenceLabel,
    }),
    [context.config, parsed, referenceLabel],
  );
  const label = viewModel.label;

  if (viewModel.kind === "blockquote") {
    return (
      <blockquote
        className={documentSurfaceClassNames(
          DOCUMENT_SURFACE_CLASS.blockquote,
          "cf-lexical-blockquote-shell",
        )}
      >
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
    <section
      className={documentSurfaceClassNames(
        DOCUMENT_SURFACE_CLASS.block,
        `cf-lexical-block cf-lexical-block--${parsed.blockType}`,
      )}
    >
      {openerEdit.active ? (
        <FencedDivStructureSourceEditor
          nodeKey={nodeKey}
          onClose={openerEdit.deactivate}
          raw={raw}
        />
      ) : null}
      <header
        className={documentSurfaceClassNames(
          DOCUMENT_SURFACE_CLASS.blockHeader,
          "cf-lexical-block-header",
        )}
      >
        <span
          className={documentSurfaceClassNames(
            DOCUMENT_SURFACE_CLASS.blockLabel,
            "cf-lexical-block-label cf-lexical-structure-toggle",
          )}
          {...structureToggleProps(surfaceEditable, openerEdit.activate)}
        >
          {label}
        </span>
        {parsed.titleMarkdown ? (
          <div
            className={documentSurfaceClassNames(
              DOCUMENT_SURFACE_CLASS.blockTitle,
              "cf-lexical-block-title",
            )}
            ref={titleShellRef}
          >
            <EmbeddedFieldEditor
              activation="focus"
              className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--title"
              doc={parsed.titleMarkdown}
              family="title"
              namespace={`coflat-block-title-${nodeKey}`}
              onSelectionChange={titleOffset === null ? undefined : onTitleSelectionChange}
              onTextChange={(nextTitle) => {
                publishTitleSelection(nextTitle);
                updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
                  titleMarkdown: nextTitle,
                }));
                queueMicrotask(() => publishTitleSelection(nextTitle));
                requestAnimationFrame(() => publishTitleSelection(nextTitle));
                setTimeout(() => publishTitleSelection(nextTitle), 0);
                setTimeout(() => publishTitleSelection(nextTitle), 100);
              }}
              pendingFocusId={pendingTitleFocusId}
            />
          </div>
        ) : null}
      </header>
      <div
        className={documentSurfaceClassNames(
          DOCUMENT_SURFACE_CLASS.blockBody,
          "cf-lexical-block-body",
        )}
      >
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
