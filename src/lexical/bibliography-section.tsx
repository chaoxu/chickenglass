import { useEffect, useMemo } from "react";

import { buildBibliographyEntries } from "../citations/bibliography";
import { useLexicalRenderContext } from "./render-context";

export function BibliographySection() {
  const { citations } = useLexicalRenderContext();

  const entries = useMemo(() => {
    if (citations.store.size === 0 || citations.citedIds.length === 0) {
      return [];
    }
    const cslHtml = citations.cslProcessor?.bibliography([...citations.citedIds]) ?? [];
    return buildBibliographyEntries(citations.store, citations.citedIds, cslHtml);
  }, [citations]);

  useEffect(() => {
    const assignAnchors = () => {
      const citationNodes = [...document.querySelectorAll<HTMLElement>("[data-coflat-citation='true']")];
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
  }, [entries]);

  if (entries.length === 0) {
    return null;
  }

  const hasRenderedHtml = entries.some((entry) => typeof entry.renderedHtml === "string");

  return (
    <section className="cf-bibliography cf-lexical-bibliography">
      <h2 className="cf-bibliography-heading">References</h2>
      <div className="cf-bibliography-list">
        {entries.map((entry, index) => (
          <div className="cf-bibliography-entry" id={`bib-${entry.id}`} key={entry.id}>
            {entry.renderedHtml ? (
              <span dangerouslySetInnerHTML={{ __html: entry.renderedHtml }} />
            ) : (
              <span>{`[${index + 1}] ${entry.plainText}`}</span>
            )}
            {citations.backlinks.get(entry.id)?.length ? (
              <span className="cf-bibliography-backlinks">
                {citations.backlinks.get(entry.id)?.map((backlink) => (
                  <a
                    aria-label="Jump to citation"
                    className="cf-bibliography-backlink"
                    href={`#cite-ref-${backlink.occurrence}`}
                    key={`${entry.id}-${backlink.occurrence}`}
                  >
                    {hasRenderedHtml ? "\u21a9" : "\u21a9"}
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
