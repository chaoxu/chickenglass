/**
 * Compatibility barrel for historical render utility imports.
 *
 * New code should prefer importing from the focused owner modules or from
 * `render-core.ts` when it needs the shared low-level surface.
 */

export * from "./node-collection";
export * from "./widget-core";
export * from "./source-widget";
export * from "./reference-widget";
export * from "./shell-widget";
export * from "./decoration-core";
export * from "./focus-state";
export * from "./scroll-anchor";
export * from "./viewport-diff";
export * from "./view-plugin-factories";
export * from "./decoration-field";
