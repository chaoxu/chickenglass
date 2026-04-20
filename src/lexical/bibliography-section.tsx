import DOMPurify from "dompurify";
import { useEffect, useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { buildBibliographyEntries } from "../citations/bibliography";
import { useLexicalRenderContext } from "./render-context";
import { renderCitationTextHtml, renderCitationTextInHtml } from "./markdown/citation-text-html";

export function BibliographySection() {
  const [editor] = useLexicalComposerContext();
  const context = useLexicalRenderContext();
  const { citations } = context;

  const entries = useMemo(() => {
    if (citations.store.size === 0 || citations.citedIds.length === 0) {
      return [];
    }
    const cslHtml = citations.cslProcessor?.bibliography([...citations.citedIds]) ?? [];
    return buildBibliographyEntries(citations.store, citations.citedIds, cslHtml);
  }, [citations]);

  const renderOptions = useMemo(() => ({
    citations: context.citations,
    config: context.config,
    docPath: context.docPath,
    renderIndex: context.renderIndex,
    resolveAssetUrl: context.resolveAssetUrl,
  }), [context]);

  const renderedEntries = useMemo(() => entries.map((entry, index) => {
    const html = entry.renderedHtml
      ? renderCitationTextInHtml(entry.renderedHtml, renderOptions)
      : renderCitationTextHtml(`[${index + 1}] ${entry.plainText}`, renderOptions);
    return {
      ...entry,
      renderedHtml: DOMPurify.sanitize(html),
    };
  }), [entries, renderOptions]);

  useEffect(() => {
    const assignAnchors = () => {
      const root = editor.getRootElement();
      if (!root) {
        return;
      }
      const citationNodes = [...root.querySelectorAll<HTMLElement>("[data-coflat-citation='true']")];
      citationNodes.forEach((node, index) => {
        node.id = `cite-ref-${index + 1}`;
      });
    };

    assignAnchors();
    queueMicrotask(assignAnchors);
    const raf = requestAnimationFrame(assignAnchors);
    const timeout = window.setTimeout(assignAnchors, 0);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [editor, renderedEntries]);

  if (renderedEntries.length === 0) {
    return null;
  }

  return (
    <section className="cf-bibliography cf-lexical-bibliography">
      <h2 className="cf-bibliography-heading">References</h2>
      <div className="cf-bibliography-list">
        {renderedEntries.map((entry) => (
          <div className="cf-bibliography-entry" id={`bib-${entry.id}`} key={entry.id}>
            <div
              className="cf-bibliography-entry-content"
              dangerouslySetInnerHTML={{ __html: entry.renderedHtml }}
            />
            {citations.backlinks.get(entry.id)?.length ? (
              <span className="cf-bibliography-backlinks">
                {citations.backlinks.get(entry.id)?.map((backlink) => (
                  <a
                    aria-label="Jump to citation"
                    className="cf-bibliography-backlink"
                    href={`#cite-ref-${backlink.occurrence}`}
                    key={`${entry.id}-${backlink.occurrence}`}
                  >
                    {"\u21a9"}
                  </a>
                ))}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
