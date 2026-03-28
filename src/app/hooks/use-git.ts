import { useState, useEffect, useCallback, useRef } from "react";
import { gitClient, runFreshGitQuery } from "../git-command";
import type { GitStatusResult } from "../tauri-client/git";

export interface GitController {
  status: GitStatusResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<string | null>;
}

export function useGit(projectRoot: string | null): GitController {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const fetchStatus = useCallback(() => {
    runFreshGitQuery({
      projectRoot,
      requestRef,
      command: (c) => c.gitStatusCommand(),
      onGated: () => setStatus(null),
      onResult: (result) => { setStatus(result); setError(null); },
      onError: (e) => setError(String(e)),
    });
  }, [projectRoot]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const stage = useCallback(async (paths: string[]) => {
    try {
      const { gitStageCommand } = await gitClient();
      await gitStageCommand(paths);
      fetchStatus();
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [fetchStatus]);

  const unstage = useCallback(async (paths: string[]) => {
    try {
      const { gitUnstageCommand } = await gitClient();
      await gitUnstageCommand(paths);
      fetchStatus();
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [fetchStatus]);

  const commit = useCallback(async (message: string): Promise<string | null> => {
    if (!message.trim()) return null;
    setLoading(true);
    setError(null);
    try {
      const { gitCommitCommand } = await gitClient();
      const result = await gitCommitCommand(message);
      fetchStatus();
      return result.oid;
    } catch (e: unknown) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  return {
    status,
    loading,
    error,
    refresh: fetchStatus,
    stage,
    unstage,
    commit,
  };
}
