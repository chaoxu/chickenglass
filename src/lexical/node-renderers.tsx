import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from "react";
import katex from "katex";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";

import { SurfaceFloatingPortal } from "../lexical-next";
import { EmbeddedFieldEditor } from "./embedded-field-editor";
import { useLexicalSurfaceEditable } from "./editability-context";
import { EditorChromeBody, EditorChromeInput, EditorChromePanel } from "./editor-chrome";
import { computeEmbedSrc, embedSandboxPermissions } from "./embed";
import { FigureMedia } from "./figure-media";
import { useAssetPreview } from "./media-preview";
import { LexicalRichMarkdownEditor } from "./rich-markdown-editor";
import { FloatingPreviewPortal, PreviewHtml, ReferenceHoverPreviewPortal } from "./hover-preview-plugin";
import { useIncludedDocument, useLexicalRenderContext } from "./render-context";
import { $isRawBlockNode, type RawBlockVariant } from "./nodes/raw-block-node";
import { StructureSourceEditor } from "./structure-source-editor";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";
import { updateTableBodyCell, updateTableHeaderCell } from "../state/table-edit";
import {
  parseStructuredDisplayMathRaw,
  parseStructuredFencedDivRaw,
  serializeFencedDivRaw,
} from "./markdown/block-syntax";
import { getPendingEmbeddedSurfaceFocusId } from "./pending-surface-focus";
import { humanizeBlockType } from "./markdown/block-metadata";
import {
  parseFootnoteDefinition,
  serializeFootnoteDefinition,
} from "./markdown/footnotes";
import { parseMarkdownImage } from "./markdown/image-markdown";
import {
  type ParsedReferenceToken,
  parseReferenceToken,
  renderReferenceDisplay,
} from "./markdown/reference-display";
import { renderMarkdownRichHtml } from "./markdown/rich-html-preview";
import { parseMarkdownTable, serializeMarkdownTable } from "./markdown/table-markdown";
import { buildKatexOptions } from "../lib/katex-options";
import { parseFrontmatter } from "../lib/frontmatter";

function getFirstLine(raw: string): string {
  return raw.split("\n")[0] ?? "";
}

function replaceFirstLine(raw: string, nextFirstLine: string): string {
  const lines = raw.split("\n");
  lines[0] = nextFirstLine;
  return lines.join("\n");
}

function structureToggleProps(
  active: boolean,
  onActivate: () => void,
  options?: { stopPropagation?: boolean },
): Record<string, unknown> {
  if (!active) return {};
  const stop = options?.stopPropagation;
  return {
    onClick: (e: React.SyntheticEvent) => { e.preventDefault(); if (stop) e.stopPropagation(); onActivate(); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (stop) e.stopPropagation(); onActivate(); }
    },
    role: "button",
    tabIndex: 0,
  };
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

function useRawBlockUpdater(nodeKey: NodeKey): (raw: string) => void {
  const [editor] = useLexicalComposerContext();

  return useCallback((nextRaw: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isRawBlockNode(node) || node.getRaw() === nextRaw) {
        return;
      }
      node.setRaw(nextRaw);
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });
  }, [editor, nodeKey]);
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

export function InlineImageRenderer({
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
      inputRef.current?.focus();
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
        className="cf-lexical-inline-image"
        src={preview.previewUrl}
      />
    </span>
  );
}

export function ReferenceRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const { citations, renderIndex } = useLexicalRenderContext();
  const [editor] = useLexicalComposerContext();
  const parsed = useMemo(() => parseReferenceToken(raw), [raw]);
  const [draft, setDraft] = useState(raw);
  const [editingAnchor, setEditingAnchor] = useState<HTMLElement | null>(null);
  const [hoveredPreview, setHoveredPreview] = useState<{ anchor: HTMLElement; id: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const text = useMemo(
    () => renderReferenceDisplay(raw, renderIndex, citations),
    [citations, raw, renderIndex],
  );

  useEffect(() => {
    if (!editingAnchor) {
      setDraft(raw);
    }
  }, [editingAnchor, raw]);

  useEffect(() => {
    if (editingAnchor) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingAnchor]);

  const commitDraft = useCallback((nextRaw: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      const referenceNode = node as { setRaw?: (value: string) => unknown } | null;
      if (referenceNode?.setRaw) {
        referenceNode.setRaw(nextRaw);
      }
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });
  }, [editor, nodeKey]);

  const handleHoverStart = useCallback((id: string) => (event: ReactMouseEvent<HTMLElement>) => {
    setHoveredPreview({
      anchor: event.currentTarget,
      id,
    });
  }, []);
  const handleHoverEnd = useCallback(() => {
    setHoveredPreview(null);
  }, []);

  const openEditor = useCallback((event: React.SyntheticEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHoveredPreview(null);
    setEditingAnchor(event.currentTarget);
  }, []);

  const openEditorOnKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      openEditor(event);
    }
  };

  const renderSingleItem = useCallback((
    itemRaw: string,
    id: string,
    citation: boolean,
  ) => (
    <span
      className={citation ? "cf-citation" : "cf-crossref"}
      data-coflat-ref-id={id}
      key={id}
      onMouseEnter={handleHoverStart(id)}
      onMouseLeave={handleHoverEnd}
    >
      {renderReferenceDisplay(itemRaw, renderIndex, citations)}
    </span>
  ), [citations, handleHoverEnd, handleHoverStart, renderIndex]);

  const inputWidthCh = Math.max(3, draft.length + 1);

  const editingPortal = editingAnchor
    ? (
      <SurfaceFloatingPortal anchor={editingAnchor}>
        <EditorChromePanel className="cf-lexical-floating-source-shell cf-lexical-inline-token-panel-shell">
          <EditorChromeBody className="cf-lexical-floating-source-surface cf-lexical-inline-token-panel-surface">
            <EditorChromeInput
              className="cf-lexical-inline-token-source cf-lexical-floating-source-editor cf-lexical-inline-token-panel-editor"
              onBlur={() => {
                commitDraft(draft);
                setEditingAnchor(null);
              }}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraft(draft);
                  setEditingAnchor(null);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(raw);
                  setEditingAnchor(null);
                }
              }}
              ref={inputRef}
              size={inputWidthCh}
              style={{
                width: `min(calc(100vw - 8px), calc(${inputWidthCh}ch + 0.2rem))`,
              }}
              value={draft}
            />
          </EditorChromeBody>
        </EditorChromePanel>
      </SurfaceFloatingPortal>
    )
    : null;

  if (!parsed) {
    return <span className="cf-lexical-reference">{text}</span>;
  }

  const wrapperClass = parsed.ids.some((id) => citations.store.has(id))
    ? "cf-lexical-reference cf-citation"
    : "cf-lexical-reference cf-crossref";

  if (!parsed.bracketed) {
    const id = parsed.ids[0];
    const citation = citations.store.has(id);
    return (
      <>
        <span
          className={wrapperClass}
          data-coflat-citation={citation ? "true" : undefined}
          data-coflat-reference="true"
          data-coflat-single-ref-id={id}
          onClick={openEditor}
          onKeyDown={openEditorOnKey}
          onMouseEnter={handleHoverStart(id)}
          onMouseLeave={handleHoverEnd}
        >
          {text}
        </span>
        {hoveredPreview && !editingAnchor ? <ReferenceHoverPreviewPortal anchor={hoveredPreview.anchor} id={hoveredPreview.id} /> : null}
        {editingPortal}
      </>
    );
  }

  const allCitations = parsed.ids.every((id) => citations.store.has(id));
  if (allCitations) {
    const singleId = parsed.ids.length === 1 ? parsed.ids[0] : undefined;
    return (
      <>
        <span
          className={wrapperClass}
          data-coflat-citation="true"
          data-coflat-reference="true"
          data-coflat-single-ref-id={singleId}
          onClick={openEditor}
          onKeyDown={openEditorOnKey}
          onMouseEnter={singleId ? handleHoverStart(singleId) : undefined}
          onMouseLeave={handleHoverEnd}
        >
          {text}
        </span>
        {hoveredPreview && !editingAnchor ? <ReferenceHoverPreviewPortal anchor={hoveredPreview.anchor} id={hoveredPreview.id} /> : null}
        {editingPortal}
      </>
    );
  }

  const allLocalReferences = parsed.ids.every((id) => !citations.store.has(id));
  if (!allLocalReferences) {
    return (
      <>
        <span
          className={wrapperClass}
          data-coflat-reference="true"
          onClick={openEditor}
          onKeyDown={openEditorOnKey}
        >
          {text}
        </span>
        {hoveredPreview && !editingAnchor ? <ReferenceHoverPreviewPortal anchor={hoveredPreview.anchor} id={hoveredPreview.id} /> : null}
        {editingPortal}
      </>
    );
  }

  return (
    <>
      <span
        className={wrapperClass}
        data-coflat-reference="true"
        onClick={openEditor}
        onKeyDown={openEditorOnKey}
      >
        {renderReferenceCluster(parsed, renderSingleItem)}
      </span>
      {hoveredPreview && !editingAnchor ? <ReferenceHoverPreviewPortal anchor={hoveredPreview.anchor} id={hoveredPreview.id} /> : null}
      {editingPortal}
    </>
  );
}

export function FootnoteReferenceRenderer({
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
        className="cf-lexical-footnote-ref"
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
}

function renderReferenceCluster(
  parsed: ParsedReferenceToken,
  renderItem: (itemRaw: string, id: string, citation: boolean) => JSX.Element,
) {
  return parsed.ids.flatMap((id, index) => {
    const nodes: Array<JSX.Element | string> = [];
    if (index > 0) {
      nodes.push("; ");
    }
    nodes.push(renderItem(`[@${id}]`, id, false));
    return nodes;
  });
}

function FrontmatterRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const surfaceEditable = useLexicalSurfaceEditable();
  const context = useLexicalRenderContext();
  const title = parseFrontmatter(raw).config.title ?? "";
  const updateRaw = useRawBlockUpdater(nodeKey);
  const [editingSource, setEditingSource] = useState(false);

  const titleHtml = useMemo(
    () => title ? renderMarkdownRichHtml(title, richHtmlOptions(context)) : "",
    [title, context],
  );

  return (
    <header className={`cf-lexical-title-shell${editingSource ? " is-editing-source" : ""}`}>
      {editingSource ? (
        <StructureSourceEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--frontmatter"
          doc={raw}
          multiline
          namespace={`coflat-frontmatter-source-${nodeKey}`}
          onChange={updateRaw}
          onClose={() => setEditingSource(false)}
        />
      ) : (
        <div
          className="cf-lexical-structure-toggle cf-lexical-structure-toggle--frontmatter"
          {...structureToggleProps(surfaceEditable, () => setEditingSource(true))}
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

function DisplayMathBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const { config, renderIndex } = useLexicalRenderContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const parsed = useMemo(() => parseStructuredDisplayMathRaw(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const [editing, setEditing] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const equation = useMemo(
    () => katex.renderToString(parsed.body, buildKatexOptions(true, config.math)),
    [config.math, parsed.body],
  );
  const label = parsed.id ? renderIndex.references.get(parsed.id)?.shortLabel : undefined;

  return (
    <div
      className={`cf-lexical-display-math${editing ? " is-editing" : ""}`}
      onBlurCapture={(event) => {
        const nextFocused = event.relatedTarget;
        if (nextFocused instanceof Node && shellRef.current?.contains(nextFocused)) {
          return;
        }
        setEditing(false);
      }}
      ref={shellRef}
    >
      {!editing ? (
        <>
          <div
            className="cf-lexical-display-math-body"
            dangerouslySetInnerHTML={{ __html: equation }}
            {...structureToggleProps(surfaceEditable, () => setEditing(true))}
          />
          {label ? (
            <div
              className="cf-lexical-display-math-label"
              {...structureToggleProps(surfaceEditable, () => setEditing(true))}
            >
              {label}
            </div>
          ) : null}
        </>
      ) : (
        <div
          className="cf-lexical-display-math-editor"
        >
          <StructureSourceEditor
            className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--math"
            doc={raw}
            multiline
            namespace={`coflat-display-math-${nodeKey}`}
            onChange={updateRaw}
            onClose={() => setEditing(false)}
          />
        </div>
      )}
    </div>
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

function TableBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const externalParsed = useMemo(() => parseMarkdownTable(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const [draft, setDraft] = useState(externalParsed);

  useEffect(() => {
    setDraft(externalParsed);
  }, [externalParsed]);

  const updateHeaderCell = useCallback((columnIndex: number, nextValue: string) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const next = updateTableHeaderCell(prev, columnIndex, nextValue);
      updateRaw(serializeMarkdownTable(next));
      return next;
    });
  }, [updateRaw]);

  const updateBodyCell = useCallback((rowIndex: number, columnIndex: number, nextValue: string) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const next = updateTableBodyCell(prev, rowIndex, columnIndex, nextValue);
      updateRaw(serializeMarkdownTable(next));
      return next;
    });
  }, [updateRaw]);

  if (!draft) {
    return <div className="cf-lexical-raw-fallback">{raw}</div>;
  }

  return (
    <div className="cf-lexical-table-block">
      <table>
        <thead>
          <tr>
            {draft.headers.map((cell, columnIndex) => (
              <th key={`h-${columnIndex}`}>
                <EmbeddedFieldEditor
                  activation="focus"
                  className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--table-cell"
                  doc={cell}
                  family="table-cell"
                  namespace={`coflat-table-${nodeKey}-head-${columnIndex}`}
                  onTextChange={(nextValue) => updateHeaderCell(columnIndex, nextValue)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {draft.rows.map((row, rowIndex) => (
            <tr key={`r-${rowIndex}`}>
              {row.map((cell, columnIndex) => (
                <td key={`c-${rowIndex}-${columnIndex}`}>
                  <EmbeddedFieldEditor
                    activation="focus"
                    className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--table-cell"
                    doc={cell}
                    family="table-cell"
                    namespace={`coflat-table-${nodeKey}-${rowIndex}-${columnIndex}`}
                    onTextChange={(nextValue) => updateBodyCell(rowIndex, columnIndex, nextValue)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  const [editingPath, setEditingPath] = useState(false);

  return (
    <section
      className="cf-lexical-include-shell"
      onBlurCapture={(event) => {
        const nextFocused = event.relatedTarget;
        if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
          return;
        }
        setEditingPath(false);
      }}
    >
      <div className="cf-lexical-include-meta">
        {surfaceEditable ? (
          <button
            className="cf-lexical-include-path-toggle cf-lexical-structure-toggle cf-lexical-structure-toggle--include"
            onMouseDown={(event) => {
              event.preventDefault();
              setEditingPath(true);
            }}
            type="button"
          >
            {parsed.bodyMarkdown.trim()}
          </button>
        ) : (
          <span className="cf-lexical-include-path-label">{parsed.bodyMarkdown.trim()}</span>
        )}
      </div>
      {editingPath ? (
        <StructureSourceEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--include"
          doc={parsed.bodyMarkdown.trim()}
          namespace={`coflat-include-path-${nodeKey}`}
          onChange={(nextPath) => updateRaw(serializeFencedDivRaw(parsed, {
            bodyMarkdown: nextPath,
          }))}
          onClose={() => setEditingPath(false)}
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
  const [editingOpener, setEditingOpener] = useState(false);
  const pendingBodyFocusId = usePendingEmbeddedSurfaceFocusId(nodeKey, "block-body");

  return (
    <section className={`cf-lexical-block cf-lexical-block--${parsed.blockType} cf-lexical-block--captioned`}>
      {editingOpener ? (
        <FencedDivStructureSourceEditor
          nodeKey={nodeKey}
          onClose={() => setEditingOpener(false)}
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
            {...structureToggleProps(surfaceEditable, () => setEditingOpener(true))}
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
  const [editing, setEditing] = useState(false);
  const [editingOpener, setEditingOpener] = useState(false);
  const shellRef = useRef<HTMLElement | null>(null);
  const src = useMemo(
    () => computeEmbedSrc(parsed.blockType, parsed.bodyMarkdown),
    [parsed.blockType, parsed.bodyMarkdown],
  );

  return (
    <section
      className={`cf-lexical-block cf-lexical-block--embed cf-lexical-block--${parsed.blockType}`}
      onBlurCapture={(event) => {
        const nextFocused = event.relatedTarget;
        if (nextFocused instanceof Node && shellRef.current?.contains(nextFocused)) {
          return;
        }
        setEditing(false);
      }}
      ref={shellRef}
    >
      <header className="cf-lexical-block-header">
        <span
          className="cf-lexical-block-label cf-lexical-structure-toggle"
          {...structureToggleProps(surfaceEditable, () => setEditingOpener(true))}
        >
          {label}
        </span>
      </header>
      {editingOpener ? (
        <FencedDivStructureSourceEditor
          nodeKey={nodeKey}
          onClose={() => setEditingOpener(false)}
          raw={raw}
        />
      ) : null}
      <div className="cf-lexical-block-body">
        {editing ? (
          <StructureSourceEditor
            className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--embed"
            doc={parsed.bodyMarkdown.trim()}
            namespace={`coflat-embed-${nodeKey}`}
            onChange={(nextBody) => updateRaw(serializeFencedDivRaw(parsed, {
              bodyMarkdown: nextBody,
            }))}
            onClose={() => setEditing(false)}
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
                setEditing(true);
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
  const [editingOpener, setEditingOpener] = useState(false);
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
      {editingOpener ? (
        <FencedDivStructureSourceEditor
          nodeKey={nodeKey}
          onClose={() => setEditingOpener(false)}
          raw={raw}
        />
      ) : null}
      <header className="cf-lexical-block-header">
        <span
          className="cf-lexical-block-label cf-lexical-structure-toggle"
          {...structureToggleProps(surfaceEditable, () => setEditingOpener(true))}
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

export function RawBlockRenderer({
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
}
