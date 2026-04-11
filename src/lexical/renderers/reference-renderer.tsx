import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";

import { SurfaceFloatingPortal } from "../../lexical-next";
import { EditorChromeBody, EditorChromeInput, EditorChromePanel } from "../editor-chrome";
import { ReferenceHoverPreviewPortal } from "../hover-preview-plugin";
import { useLexicalRenderContext } from "../render-context";
import { COFLAT_NESTED_EDIT_TAG } from "../update-tags";
import {
  type ParsedReferenceToken,
  parseReferenceToken,
  renderReferenceDisplay,
} from "../markdown/reference-display";

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
      inputRef.current?.focus({ preventScroll: true });
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

  const openEditor = useCallback((event: SyntheticEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHoveredPreview(null);
    setEditingAnchor(event.currentTarget);
  }, []);

  const openEditorOnKey = (event: KeyboardEvent<HTMLElement>) => {
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
