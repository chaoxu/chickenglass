/**
 * Barrel file for centralized constants.
 *
 * Re-exports block manifest, CSS class names, Lezer node types,
 * timing limits, layout dimensions, DOM event names, and storage keys.
 */

export {
  ALGORITHM_COUNTER,
  BLOCK_MANIFEST,
  COUNTER_GROUPS,
  DEFINITION_COUNTER,
  EXCLUDED_FROM_FALLBACK,
  STYLED_BLOCK_NAMES,
  THEOREM_COUNTER,
  type BlockManifestEntry,
  type BlockName,
  type BodyStyle,
  type SpecialBehavior,
} from "./block-manifest";

export { CSS } from "./css-classes";

export { NODE, type NodeTypeName } from "./node-types";

export {
  IMAGE_TIMEOUT_MS,
  SEARCH_CONTEXT_BUFFER,
  HOVER_DELAY_MS,
  COPY_RESET_MS,
  READING_WPM,
  MAX_PERF_RECORDS,
  MAX_PERF_OPERATIONS,
} from "./timing";

export {
  CONTENT_MAX_WIDTH,
  MARGIN_RIGHT_CALC,
  SIDENOTE_OFFSET,
  SIDENOTE_WIDTH,
  IMAGE_MAX_HEIGHT,
} from "./layout";

export {
  PERF_PANEL_TOGGLE_EVENT,
  PERF_PANEL_REFRESH_EVENT,
  FORMAT_EVENT,
  MODE_CHANGE_EVENT,
} from "./events";

export {
  SETTINGS_KEY,
  RECENT_FILES_KEY,
  RECENT_FOLDERS_KEY,
  WINDOW_STATE_KEY,
} from "./storage-keys";
