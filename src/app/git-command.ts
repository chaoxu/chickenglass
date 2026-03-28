import { isTauri } from "../lib/tauri";

/** Lazy-loaded git client — cached by the JS module system after first import. */
export const gitClient = () => import("./tauri-client/git");
export type GitClient = Awaited<ReturnType<typeof gitClient>>;

/** Whether Tauri-backed git operations are available for the given project. */
export function isTauriGitAvailable(projectRoot: string | null): boolean {
  return isTauri() && !!projectRoot;
}

/**
 * Run an async git query with Tauri gating, lazy import, and request-freshness
 * tracking.
 *
 * Bumps the request counter unconditionally (even when gated) so any pending
 * request from a previous project root is invalidated.
 *
 * - `onGated()` — Tauri unavailable or no project root.
 * - `onResult(value)` — query succeeded and response is still fresh.
 * - `onError(error)` — query failed and response is still fresh.
 * - (nothing) — response arrived but a newer request superseded it.
 */
export function runFreshGitQuery<T>(opts: {
  projectRoot: string | null;
  requestRef: { current: number };
  command: (client: GitClient) => Promise<T>;
  onGated: () => void;
  onResult: (result: T) => void;
  onError: (error: unknown) => void;
}): void {
  const requestId = ++opts.requestRef.current;
  if (!isTauri() || !opts.projectRoot) {
    opts.onGated();
    return;
  }
  void (async () => {
    try {
      const client = await gitClient();
      const result = await opts.command(client);
      if (requestId !== opts.requestRef.current) return;
      opts.onResult(result);
    } catch (e: unknown) {
      if (requestId !== opts.requestRef.current) return;
      opts.onError(e);
    }
  })();
}
