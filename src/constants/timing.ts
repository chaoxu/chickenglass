/**
 * Timing constants used across the Coflat codebase.
 *
 * Centralizes all magic-number delays, intervals, limits, and rates so they
 * are easy to discover, adjust, and audit.
 */

/** Timeout (ms) before removing a temporary file-input element after insertion. */
export const IMAGE_TIMEOUT_MS = 60000;

/**
 * Number of characters buffered outside the visible viewport when collecting
 * search matches (gives context so matches near viewport edges are included).
 */
export const SEARCH_CONTEXT_BUFFER = 500;

/** Delay (ms) before the hover-preview tooltip appears over a reference. */
export const HOVER_DELAY_MS = 300;

/** Poll interval (ms) used when waiting for an embed iframe to load. */
export const IFRAME_POLL_INTERVAL_MS = 500;

/** Maximum number of poll attempts when waiting for an embed iframe to load. */
export const IFRAME_MAX_ATTEMPTS = 10;

/** Duration (ms) the copy-success checkmark is shown before reverting. */
export const COPY_RESET_MS = 1500;

/** Assumed reading speed (words per minute) for reading-time estimates. */
export const READING_WPM = 200;

/** Maximum number of recent perf records retained in the frontend store. */
export const MAX_PERF_RECORDS = 200;

/** Maximum number of recent perf operations retained in the frontend store. */
export const MAX_PERF_OPERATIONS = 50;
