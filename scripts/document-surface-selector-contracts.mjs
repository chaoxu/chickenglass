export const DOCUMENT_SURFACE_MODES = ["cm6-rich"];

export const DOCUMENT_SURFACE_SELECTORS = {
  block: ".cf-doc-block",
  displayMath: ".cf-doc-display-math",
  flow: {
    "cm6-rich": ".cf-doc-flow",
  },
  headingH1: ".cf-doc-heading--h1",
  paragraph: ".cf-doc-paragraph",
  surface: {
    "cm6-rich": ".cf-doc-surface",
  },
  table: ".cf-doc-table-block",
  tableCell: ".cf-doc-table-block th, .cf-doc-table-block td",
};

export function normalizeDocumentSurfaceMode(mode) {
  if (mode === "rich" || mode === "CM6 Rich") {
    return "cm6-rich";
  }
  if (DOCUMENT_SURFACE_MODES.includes(mode)) {
    return mode;
  }
  throw new Error(`Unknown document surface mode: ${mode}`);
}

export function documentSurfaceSelector(name, mode = "cm6-rich") {
  const selector = DOCUMENT_SURFACE_SELECTORS[name];
  if (!selector) {
    throw new Error(`Unknown document surface selector: ${name}`);
  }
  if (typeof selector === "string") {
    return selector;
  }
  const normalizedMode = normalizeDocumentSurfaceMode(mode);
  return selector[normalizedMode];
}

export function documentSurfaceWaitSelector(mode) {
  const normalizedMode = normalizeDocumentSurfaceMode(mode);
  return [
    documentSurfaceSelector("surface", normalizedMode),
    documentSurfaceSelector("flow", normalizedMode),
    documentSurfaceSelector("headingH1", normalizedMode),
  ].join(", ");
}

export function documentSurfaceSelectorSnapshot(mode) {
  const normalizedMode = normalizeDocumentSurfaceMode(mode);
  return {
    block: documentSurfaceSelector("block", normalizedMode),
    displayMath: documentSurfaceSelector("displayMath", normalizedMode),
    flow: documentSurfaceSelector("flow", normalizedMode),
    headingH1: documentSurfaceSelector("headingH1", normalizedMode),
    paragraph: documentSurfaceSelector("paragraph", normalizedMode),
    surface: documentSurfaceSelector("surface", normalizedMode),
    table: documentSurfaceSelector("table", normalizedMode),
    tableCell: documentSurfaceSelector("tableCell", normalizedMode),
  };
}
