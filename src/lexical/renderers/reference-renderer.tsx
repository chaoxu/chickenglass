import {
  memo,
  useCallback,
  useMemo,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { ReferenceHoverPreviewPortal } from "../hover-preview-plugin";
import { useLexicalRenderContext } from "../render-context";
import {
  type ParsedReferenceToken,
  parseReferenceToken,
  renderReferenceDisplay,
} from "../markdown/reference-display";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";
import { INLINE_TOKEN_KEY_ATTR } from "../inline-token-boundary";

function renderReferenceCluster(
  parsed: ParsedReferenceToken,
  renderItem: (itemRaw: string, id: string, citation: boolean, displayText?: string) => JSX.Element,
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

function stripReferenceWrapper(rendered: string): string {
  const trimmed = rendered.trim();
  if (
    (trimmed.startsWith("(") && trimmed.endsWith(")"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function buildBracketedCitationRaw(id: string, locator: string | undefined): string {
  return locator ? `[@${id}, ${locator}]` : `[@${id}]`;
}

function renderCitationCluster(
  parsed: ParsedReferenceToken,
  renderIndex: Parameters<typeof renderReferenceDisplay>[1],
  citations: Parameters<typeof renderReferenceDisplay>[2],
  renderItem: (itemRaw: string, id: string, citation: boolean, displayText?: string) => JSX.Element,
) {
  const nodes: Array<JSX.Element | string> = ["["];
  parsed.ids.forEach((id, index) => {
    if (index > 0) {
      nodes.push("; ");
    }
    const itemRaw = buildBracketedCitationRaw(id, parsed.locators[index]);
    nodes.push(renderItem(
      itemRaw,
      id,
      true,
      stripReferenceWrapper(renderReferenceDisplay(itemRaw, renderIndex, citations)),
    ));
  });
  nodes.push("]");
  return nodes;
}

/**
 * Pure presentation for reference/citation tokens. Source editing is
 * owned by the shared cursor-reveal engine (`cursor-reveal-plugin.tsx` +
 * `cursor-reveal-adapters.ts`); this renderer only handles the rendered
 * display and hover previews.
 */
export const ReferenceRenderer = memo(function ReferenceRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: string;
  readonly raw: string;
}) {
  const { citations, renderIndex } = useLexicalRenderContext();
  const parsed = useMemo(() => parseReferenceToken(raw), [raw]);
  const [hoveredPreview, setHoveredPreview] = useState<{ anchor: HTMLElement; id: string } | null>(null);
  const text = useMemo(
    () => renderReferenceDisplay(raw, renderIndex, citations),
    [citations, raw, renderIndex],
  );

  const handleHoverStart = useCallback((id: string) => (event: ReactMouseEvent<HTMLElement>) => {
    setHoveredPreview({
      anchor: event.currentTarget,
      id,
    });
  }, []);
  const handleHoverEnd = useCallback(() => {
    setHoveredPreview(null);
  }, []);

  const renderSingleItem = useCallback((
    itemRaw: string,
    id: string,
    citation: boolean,
    displayText?: string,
  ) => (
    <span
      className={citation ? "cf-citation" : "cf-crossref"}
      data-coflat-ref-id={id}
      key={`${id}:${itemRaw}`}
      onMouseEnter={handleHoverStart(id)}
      onMouseLeave={handleHoverEnd}
    >
      {displayText ?? renderReferenceDisplay(itemRaw, renderIndex, citations)}
    </span>
  ), [citations, handleHoverEnd, handleHoverStart, renderIndex]);

  const hoverPortal = hoveredPreview
    ? (
        <ReferenceHoverPreviewPortal
          anchor={hoveredPreview.anchor}
          id={hoveredPreview.id}
          onPointerEnter={handleHoverEnd}
        />
      )
    : null;

  if (!parsed) {
    return <span className={LEXICAL_NODE_CLASS.REFERENCE} {...{ [INLINE_TOKEN_KEY_ATTR]: nodeKey }}>{text}</span>;
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
          {...{ [INLINE_TOKEN_KEY_ATTR]: nodeKey }}
          data-coflat-citation={citation ? "true" : undefined}
          data-coflat-reference="true"
          data-coflat-single-ref-id={id}
          onMouseEnter={handleHoverStart(id)}
          onMouseLeave={handleHoverEnd}
        >
          {text}
        </span>
        {hoverPortal}
      </>
    );
  }

  const allCitations = parsed.ids.every((id) => citations.store.has(id));
  if (allCitations) {
    const singleId = parsed.ids.length === 1 ? parsed.ids[0] : undefined;
    if (!singleId) {
      return (
        <>
          <span
            className={wrapperClass}
            {...{ [INLINE_TOKEN_KEY_ATTR]: nodeKey }}
            data-coflat-citation="true"
            data-coflat-reference="true"
          >
            {renderCitationCluster(parsed, renderIndex, citations, renderSingleItem)}
          </span>
          {hoverPortal}
        </>
      );
    }

    return (
      <>
        <span
          className={wrapperClass}
          {...{ [INLINE_TOKEN_KEY_ATTR]: nodeKey }}
          data-coflat-citation="true"
          data-coflat-reference="true"
          data-coflat-single-ref-id={singleId}
          onMouseEnter={singleId ? handleHoverStart(singleId) : undefined}
          onMouseLeave={handleHoverEnd}
        >
          {text}
        </span>
        {hoverPortal}
      </>
    );
  }

  const allLocalReferences = parsed.ids.every((id) => !citations.store.has(id));
  if (!allLocalReferences) {
    return (
      <>
        <span
          className={wrapperClass}
          {...{ [INLINE_TOKEN_KEY_ATTR]: nodeKey }}
          data-coflat-reference="true"
        >
          {text}
        </span>
        {hoverPortal}
      </>
    );
  }

  return (
    <>
      <span
        className={wrapperClass}
        {...{ [INLINE_TOKEN_KEY_ATTR]: nodeKey }}
        data-coflat-reference="true"
      >
        {renderReferenceCluster(parsed, renderSingleItem)}
      </span>
      {hoverPortal}
    </>
  );
});
