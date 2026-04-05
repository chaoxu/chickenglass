import { CSS } from "./constants";

function joinClasses(...classNames: Array<string | null | undefined | false>): string {
  return classNames.filter(Boolean).join(" ");
}

function createPreviewElement(...classNames: Array<string | null | undefined | false>): HTMLDivElement {
  const el = document.createElement("div");
  el.className = joinClasses(...classNames);
  return el;
}

export function createPreviewSurfaceShell(...extraClasses: Array<string | null | undefined | false>): HTMLDivElement {
  return createPreviewElement(CSS.previewSurfaceShell, ...extraClasses);
}

export function createPreviewSurfaceContent(
  ...extraClasses: Array<string | null | undefined | false>
): HTMLDivElement {
  return createPreviewElement(CSS.previewSurfaceContent, ...extraClasses);
}

export function createPreviewSurfaceHeader(
  ...extraClasses: Array<string | null | undefined | false>
): HTMLDivElement {
  return createPreviewElement(CSS.previewSurfaceHeader, ...extraClasses);
}

export function createPreviewSurfaceBody(...extraClasses: Array<string | null | undefined | false>): HTMLDivElement {
  return createPreviewElement(CSS.previewSurfaceBody, ...extraClasses);
}
