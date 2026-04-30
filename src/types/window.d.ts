/**
 * Ambient Window augmentation for Coflat debug globals.
 *
 * These properties are set at runtime by various subsystems and consumed
 * by browser console sessions, Playwright tests, and other debug tooling.
 * Declaring them here avoids unsafe `as unknown as` double-casts throughout
 * the codebase.
 *
 * See AGENTS.md / CLAUDE.md "Debug helpers" for usage documentation.
 */

import type { EditorView } from "@codemirror/view";
import type { DebugHelpers } from "../editor";
import type {
  AppDebugBridge,
  CfDebugBridge,
  EditorDebugBridgeGlobal,
  TauriSmokeBridge,
} from "../debug/debug-bridge-contract.js";

declare global {
  interface Window {
    /**
     * The active CM6 EditorView instance.
     * Set by useEditorDebugBridge; cleared on unmount.
     */
    __cmView?: EditorView;

    /**
     * Debug helper functions for the active editor, including stable
     * rich-mode vertical motion, measured geometry snapshots, recent
     * motion-guard history, and explicit structure-edit helpers used by
     * browser regressions.
     * Set by useEditorDebugBridge; cleared on unmount.
     */
    __cmDebug?: DebugHelpers;

    /**
     * Toggle flag for fenced-div parser tracing.
     * Set `true` in the console to enable verbose parser logging.
     */
    __fencedDivDebug?: boolean;

    /**
     * App-level debug helpers exposed for console and Playwright testing.
     * Set by useAppDebug; cleared on unmount.
     */
    __app?: AppDebugBridge;

    /**
     * Product-neutral editor debug bridge that delegates to the active
     * CM6 `EditorView`.
     */
    __editor?: EditorDebugBridgeGlobal;

    /**
     * Performance debug helpers.
     * Set by useAppDebug; cleared on unmount.
     */
    __cfDebug?: CfDebugBridge;

    /**
     * Dev-only native smoke helpers exposed in Tauri debug builds.
     * Set by useAppDebug; cleared on unmount.
     */
    __tauriSmoke?: TauriSmokeBridge;
  }
}
