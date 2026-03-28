/**
 * Hook: HTML content pipeline for read mode.
 *
 * Synchronously builds base HTML from markdown, then asynchronously resolves
 * local image/PDF overrides and re-renders with the resolved URLs.
 */

import { useMemo, useState, useEffect } from "react";
import { markdownToHtml } from "../markdown-to-html";
import type { BibStore } from "../../citations/citation-render";
import type { FrontmatterConfig } from "../../parser/frontmatter";
import type { CslProcessor } from "../../citations/csl-processor";
import { renderDocumentFragmentToHtml } from "../../document-surfaces";
import { resolveLocalImageOverrides } from "../pdf-image-previews";
import type { FileSystem } from "../file-manager";
import { measureAsync } from "../perf";

function buildReadModeHtml(
  content: string,
  frontmatterConfig: FrontmatterConfig,
  bibliography?: BibStore,
  cslProcessor?: CslProcessor,
  documentPath = "",
  imageUrlOverrides?: ReadonlyMap<string, string>,
): string {
  const bodyHtml = markdownToHtml(content, {
    macros: frontmatterConfig.math,
    sectionNumbers: true,
    bibliography,
    cslProcessor,
    documentPath,
    imageUrlOverrides,
  });

  const titleHtml = frontmatterConfig.title
    ? `<h1 class="cf-read-title">${renderDocumentFragmentToHtml({
      kind: "title",
      text: frontmatterConfig.title,
      macros: frontmatterConfig.math,
    })}</h1>`
    : "";

  return titleHtml + bodyHtml;
}

/**
 * Compute final read-mode HTML, including async PDF/image preview overrides.
 *
 * Returns the current HTML string. The first render uses synchronous output;
 * once image overrides resolve the HTML is updated with override URLs.
 */
export function useReadModeHtml(
  content: string,
  frontmatterConfig: FrontmatterConfig,
  bibliography?: BibStore,
  cslProcessor?: CslProcessor,
  docPath?: string,
  fs?: FileSystem,
): string {
  const resolvedDocPath = docPath ?? "";

  const baseHtmlContent = useMemo(
    () => buildReadModeHtml(content, frontmatterConfig, bibliography, cslProcessor, resolvedDocPath),
    [content, frontmatterConfig, bibliography, cslProcessor, resolvedDocPath],
  );
  const [htmlContent, setHtmlContent] = useState(baseHtmlContent);

  useEffect(() => {
    let cancelled = false;
    setHtmlContent(baseHtmlContent);

    if (!fs) return () => {
      cancelled = true;
    };

    void measureAsync("read_mode.pdf_previews", async () => {
      const imageUrlOverrides = await resolveLocalImageOverrides(content, fs, resolvedDocPath);
      if (cancelled || imageUrlOverrides.size === 0) return;
      setHtmlContent(
        buildReadModeHtml(
          content,
          frontmatterConfig,
          bibliography,
          cslProcessor,
          resolvedDocPath,
          imageUrlOverrides,
        ),
      );
    }, {
      category: "read_mode",
      detail: docPath,
    }).catch(() => {
      // Silently ignore preview-preparation errors — broken-image fallback remains.
    });

    return () => {
      cancelled = true;
    };
  }, [baseHtmlContent, bibliography, content, cslProcessor, docPath, frontmatterConfig, fs]);

  return htmlContent;
}
