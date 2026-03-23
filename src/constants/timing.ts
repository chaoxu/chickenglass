/**
 * Timing constants used across the Coflat codebase.
 *
 * Centralizes all magic-number delays, intervals, limits, and rates so they
 * are easy to discover, adjust, and audit.
 */

/**
 * Timeout (ms) before removing a temporary file-input element after insertion.
 * 60 s is generous enough for slow system file-picker dialogs to open and the
 * user to confirm a selection, without leaking the element indefinitely.
 */
export const IMAGE_TIMEOUT_MS = 60000;

/**
 * Number of characters buffered outside the visible viewport when collecting
 * search matches (gives context so matches near viewport edges are included).
 * 500 chars (~5 lines) is wide enough to catch matches just off-screen while
 * staying negligible compared to typical document sizes.
 */
export const SEARCH_CONTEXT_BUFFER = 500;

/**
 * Delay (ms) before the hover-preview tooltip appears over a reference.
 * 300 ms matches the de-facto standard for tooltip delays (fast enough to feel
 * responsive, long enough to not flash on casual mouse movement).
 */
export const HOVER_DELAY_MS = 300;

/**
 * Poll interval (ms) used when waiting for an embed iframe to load.
 * 500 ms is a reasonable balance: short enough to start rendering quickly,
 * long enough to avoid hammering the DOM with checks.
 */
export const IFRAME_POLL_INTERVAL_MS = 500;

/**
 * Maximum number of poll attempts when waiting for an embed iframe to load.
 * 10 attempts × 500 ms = 5 s total timeout. After this point the embed is
 * considered failed and the placeholder is left in place rather than retrying
 * indefinitely.
 */
export const IFRAME_MAX_ATTEMPTS = 10;

/**
 * Duration (ms) the copy-success checkmark is shown before reverting to the
 * copy icon. 1500 ms is long enough to register visually without disrupting
 * workflow.
 */
export const COPY_RESET_MS = 1500;

/**
 * Assumed reading speed (words per minute) for reading-time estimates.
 * 200 WPM is the commonly cited average adult silent-reading speed; used as a
 * simple baseline without profiling the actual reader.
 */
export const READING_WPM = 200;

/**
 * Maximum number of recent perf records retained in the frontend store.
 * 200 entries keeps the perf panel useful for spotting regressions without
 * accumulating unbounded memory over a long editing session.
 */
export const MAX_PERF_RECORDS = 200;

/**
 * Maximum number of recent perf operations retained in the frontend store.
 * 50 operations is enough to show the most recent burst of activity while
 * keeping the panel scannable.
 */
export const MAX_PERF_OPERATIONS = 50;
