/**
 * Ambient Window augmentation for Coflat debug globals.
 *
 * These surfaces are eagerly installed by `src/debug/debug-bridge.ts` at
 * module load, so `window.__app`, `window.__editor`, `window.__cmView`,
 * `window.__cmDebug`, and `window.__cfDebug` are guaranteed present in any
 * browser context that has imported application code. Methods throw
 * `DebugBridgeError` if called before `useAppDebug` connects a provider.
 *
 * `__tauriSmoke` is only installed in dev + tauri builds, so it remains
 * optional. `__cfSourceMap` reflects the currently-loaded document and may
 * legitimately be `null`.
 */

import type { SourceMap } from "../app/source-map";
import type {
  AppBridgeMethods,
  EditorBridgeMethods,
  TauriSmokeMethods,
} from "../debug/debug-bridge";

declare global {
  interface Window {
    /**
     * Source map for include expansion.
     * Set by useEditorDocumentServices when includes are expanded.
     */
    __cfSourceMap: SourceMap | null;

    /**
     * App-level debug helpers exposed for console and Playwright testing.
     * Eagerly installed by the debug bridge; methods throw until
     * `useAppDebug` connects a provider.
     */
    __app: AppBridgeMethods;

    /**
     * Editor-level debug helpers exposed for browser automation and console use.
     * Eagerly installed by the debug bridge; methods throw until an editor
     * surface mounts and `useAppDebug` connects a provider.
     */
    __editor: EditorBridgeMethods;

    __cmView: {
      dispatch: (...args: unknown[]) => void;
      dom: Element | null;
      focus: () => void;
      state: {
        doc: {
          toString: () => string;
        };
      };
    };

    __cmDebug: {
      dump: () => {
        doc: string;
        selection: {
          anchor: number;
          focus: number;
          from: number;
          to: number;
        } | null;
      };
      line: (lineNumber: number) => string | null;
      selection: () => {
        anchor: number;
        focus: number;
        from: number;
        to: number;
      } | null;
      tree: () => string;
      treeString: () => string;
    };

    /**
     * Performance debug helpers. Eagerly installed by the debug bridge.
     */
    __cfDebug: {
      perfSummary: () => Promise<unknown>;
      printPerfSummary: () => Promise<unknown>;
      clearPerf: () => Promise<void>;
      togglePerfPanel: () => void;
      toggleFps: () => boolean;
    };

    /**
     * Dev-only native smoke helpers exposed in Tauri debug builds.
     * `undefined` outside dev + tauri.
     */
    __tauriSmoke?: TauriSmokeMethods;
  }
}

export {};
