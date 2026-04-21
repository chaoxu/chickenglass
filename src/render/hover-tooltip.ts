import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";

import { CSS } from "../constants";
import { createPreviewSurfaceShell } from "../preview-surface";
import {
  EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  type LocalMediaDependencies,
} from "./media-preview";

export interface TooltipPlan {
  readonly buildContent: () => HTMLElement;
  readonly cacheScope: object;
  readonly dependsOnBibliography: boolean;
  readonly dependsOnMacros: boolean;
  readonly key: string;
  readonly mediaDependencies: LocalMediaDependencies;
}

let tooltipEl: HTMLDivElement | null = null;
let cleanupAutoUpdate: (() => void) | null = null;
let currentFloatingAnchor: HTMLElement | null = null;
let refreshFloatingPosition: (() => void) | null = null;
let showGeneration = 0;

const TOOLTIP_CONTENT_CACHE_LIMIT = 8;
const tooltipContentCache = new WeakMap<object, Map<string, HTMLElement>>();

function getTooltipContentCache(cacheScope: object): Map<string, HTMLElement> {
  let cache = tooltipContentCache.get(cacheScope);
  if (!cache) {
    cache = new Map<string, HTMLElement>();
    tooltipContentCache.set(cacheScope, cache);
  }
  return cache;
}

function getTooltipContent(plan: TooltipPlan): HTMLElement {
  const cache = getTooltipContentCache(plan.cacheScope);
  const cached = cache.get(plan.key);
  if (cached) {
    cache.delete(plan.key);
    cache.set(plan.key, cached);
    return cached;
  }

  const content = plan.buildContent();
  cache.set(plan.key, content);
  if (cache.size > TOOLTIP_CONTENT_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string;
    cache.delete(oldestKey);
  }
  return content;
}

export function getCachedTooltipContentForTest(
  cacheScope: object,
  key: string,
  buildContent: () => HTMLElement,
): HTMLElement {
  return getTooltipContent({
    buildContent,
    cacheScope,
    dependsOnBibliography: false,
    dependsOnMacros: false,
    key,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  });
}

function getTooltipEl(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = createPreviewSurfaceShell(CSS.hoverPreviewTooltip);
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function showFloatingTooltip(anchor: HTMLElement, plan: TooltipPlan): void {
  const el = getTooltipEl();
  const content = getTooltipContent(plan);
  const anchorChanged = anchor !== currentFloatingAnchor;

  if (anchorChanged) {
    if (cleanupAutoUpdate) {
      cleanupAutoUpdate();
      cleanupAutoUpdate = null;
    }

    currentFloatingAnchor = anchor;
    const gen = ++showGeneration;

    const updatePosition = () => {
      void computePosition(anchor, el, {
        placement: "top",
        middleware: [offset(6), flip(), shift({ padding: 5 })],
      }).then(({ x, y }) => {
        if (gen !== showGeneration) return;

        Object.assign(el.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    };

    refreshFloatingPosition = updatePosition;
    cleanupAutoUpdate = autoUpdate(anchor, el, updatePosition);
  }

  if (el.firstElementChild !== content) {
    el.replaceChildren(content);
  }

  const wasHidden = el.style.display === "none";
  el.style.display = "";
  if (wasHidden) {
    el.setAttribute("data-visible", "false");
  }

  refreshFloatingPosition?.();

  if (wasHidden) {
    const visibleGeneration = showGeneration;
    requestAnimationFrame(() => {
      if (visibleGeneration === showGeneration) {
        el.setAttribute("data-visible", "true");
      }
    });
  } else {
    el.setAttribute("data-visible", "true");
  }
}

export function hideFloatingTooltip(): void {
  if (cleanupAutoUpdate) {
    cleanupAutoUpdate();
    cleanupAutoUpdate = null;
  }
  currentFloatingAnchor = null;
  refreshFloatingPosition = null;
  showGeneration += 1;
  if (tooltipEl) {
    tooltipEl.setAttribute("data-visible", "false");
    tooltipEl.style.display = "none";
  }
}

export function floatingTooltipContains(target: EventTarget | null): boolean {
  return target instanceof Node && tooltipEl?.contains(target) === true;
}

export function isFloatingTooltipVisible(): boolean {
  return tooltipEl !== null && tooltipEl.style.display !== "none";
}

export function destroyFloatingTooltip(): void {
  hideFloatingTooltip();
  tooltipEl?.remove();
  tooltipEl = null;
}

export function ensureHoverPreviewTooltipForTest(): HTMLDivElement {
  return getTooltipEl();
}

export function destroyHoverPreviewTooltipForTest(): void {
  destroyFloatingTooltip();
}
