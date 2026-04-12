/**
 * Shared types for the debug bridge. Split out of `use-app-debug.ts` so
 * `src/debug/debug-bridge.ts` can import them without a circular dependency.
 */

export interface DebugDocumentState {
  path: string;
  name: string;
  dirty: boolean;
}

export type DebugProjectFile =
  | { path: string; kind: "text"; content: string }
  | { path: string; kind: "binary"; base64: string };
