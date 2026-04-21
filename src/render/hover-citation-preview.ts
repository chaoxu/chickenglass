import type { EditorView } from "@codemirror/view";
import { buildCitationPreviewContent } from "../citations/citation-preview";
import { CSS } from "../constants";
import { createPreviewSurfaceBody } from "../preview-surface";
import { getReferencePresentationModel } from "../references/presentation";
import type { BibStore } from "../state/bib-data";
import { mathMacrosField } from "../state/math-macros";
import {
  createHoverPreviewContent,
  createHoverPreviewHeader,
} from "./hover-preview-elements";
import type { TooltipPlan } from "./hover-tooltip";
import { EMPTY_LOCAL_MEDIA_DEPENDENCIES } from "./media-preview";

interface CitationPreviewItem {
  readonly id: string;
  readonly preview: string;
}

function getCitationPreviewItems(
  view: EditorView,
  ids: readonly string[],
): readonly CitationPreviewItem[] {
  const presentation = getReferencePresentationModel(view.state);
  return ids
    .map((id) => {
      const preview = presentation.getPreviewText(id);
      if (!preview) return null;
      return { id, preview };
    })
    .filter((item): item is CitationPreviewItem => item !== null);
}

function createCitationPreviewBody(preview: string): HTMLElement {
  const item = createPreviewSurfaceBody(CSS.hoverPreviewCitation);
  item.appendChild(buildCitationPreviewContent(preview));
  return item;
}

/**
 * Build the tooltip plan for a citation hover preview.
 */
export function buildCitationTooltipPlan(
  view: EditorView,
  ids: readonly string[],
  store: BibStore,
): TooltipPlan {
  const previews = getCitationPreviewItems(view, ids);

  return {
    buildContent: () => {
      const container = createHoverPreviewContent();

      for (const itemPreview of previews) {
        container.appendChild(createCitationPreviewBody(itemPreview.preview));
      }

      if (container.children.length === 0) {
        container.appendChild(
          createHoverPreviewHeader(
            `Unknown citation: ${ids.join(", ")}`,
            {},
            CSS.hoverPreviewUnresolved,
          ),
        );
      }

      return container;
    },
    cacheScope: store,
    dependsOnBibliography: true,
    dependsOnMacros: false,
    key: `citation:cluster\0${ids.join("\0")}\0${previews.map((item) => `${item.id}:${item.preview}`).join("\0")}`,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  };
}

/**
 * Build the tooltip plan for a specific citation id within a mixed cluster.
 */
export function buildCitationItemTooltipPlan(
  view: EditorView,
  id: string,
  store: BibStore,
): TooltipPlan {
  const preview = getReferencePresentationModel(view.state).getPreviewText(id);
  if (preview) {
    return {
      buildContent: () => {
        const container = createHoverPreviewContent();
        container.appendChild(createCitationPreviewBody(preview));
        return container;
      },
      cacheScope: store,
      dependsOnBibliography: true,
      dependsOnMacros: false,
      key: `citation:item\0${id}\0${preview}`,
      mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
    };
  }

  const macros = view.state.field(mathMacrosField, false) ?? {};
  return {
    buildContent: () => {
      const container = createHoverPreviewContent();
      container.appendChild(
        createHoverPreviewHeader(
          `Unknown: @${id}`,
          macros,
          CSS.hoverPreviewUnresolved,
        ),
      );
      return container;
    },
    cacheScope: store,
    dependsOnBibliography: true,
    dependsOnMacros: false,
    key: `citation:item\0${id}\0unknown`,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  };
}
