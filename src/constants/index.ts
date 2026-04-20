/**
 * Barrel file for centralized constants.
 *
 * Re-exports block manifests, CSS class names, timing limits, layout
 * dimensions, DOM event names, and storage keys.
 */

export {
  ALGORITHM_COUNTER,
  BLOCK_MANIFEST_BY_NAME,
  BLOCK_MANIFEST,
  DEFINITION_COUNTER,
  CROSS_REFERENCE_PREFIXES,
  LATEX_ENVIRONMENT_BY_BLOCK,
  THEOREM_COUNTER,
  getBlockManifestEntry,
  getBlockPresentationKind,
  getManifestBlockTitle,
  isGenericFencedDivInsertBlock,
  isKnownManifestBlockType,
  isSearchIndexedBlock,
  type BlockPresentationKind,
  type BlockManifestEntry,
  type BlockName,
  type BodyStyle,
  type LatexExportKind,
  type SpecialBehavior,
} from "./block-manifest";

export { CSS } from "./css-classes";

export {
  IMAGE_TIMEOUT_MS,
  SEARCH_CONTEXT_BUFFER,
  HOVER_DELAY_MS,
  IFRAME_POLL_INTERVAL_MS,
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
  EMBED_IFRAME_HEIGHT,
  GIST_MIN_HEIGHT,
  ASPECT_RATIO_16_9,
} from "./layout";

export {
  PERF_PANEL_REFRESH_EVENT,
  MODE_CHANGE_EVENT,
  OPEN_FILE_EVENT,
} from "./events";

export {
  SETTINGS_KEY,
  LEGACY_THEME_KEY,
  RECENT_FILES_KEY,
  RECENT_FOLDERS_KEY,
  WINDOW_STATE_KEY,
} from "./storage-keys";
