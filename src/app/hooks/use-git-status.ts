import { useState, useEffect, useCallback, useRef } from "react";
import { isTauri } from "../../lib/tauri";
import type { GitBranchInfo } from "../tauri-client/git";

export interface GitStatus {
  branch: string | null;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  isPulling: boolean;
  isPushing: boolean;
  pull: () => void;
  push: () => void;
  refresh: () => void;
}

export function useGitStatus(
  projectRoot: string | null,
  refreshTree: () => Promise<void>,
): GitStatus {
  const [branchInfo, setBranchInfo] = useState<GitBranchInfo | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const requestRef = useRef(0);
  // Ref-based guard: state values go stale inside callbacks, but a ref
  // is always current, so concurrent pull+push is reliably prevented.
  const busyRef = useRef(false);

  const fetchBranchInfo = useCallback(() => {
    const requestId = ++requestRef.current;
    if (!isTauri() || !projectRoot) {
      setBranchInfo(null);
      return;
    }
    void (async () => {
      try {
        const { gitBranchInfoCommand } = await import("../tauri-client/git");
        const info = await gitBranchInfoCommand();
        if (requestId === requestRef.current) setBranchInfo(info);
      } catch {
        if (requestId === requestRef.current) setBranchInfo(null);
      }
    })();
  }, [projectRoot]);

  useEffect(() => {
    fetchBranchInfo();
  }, [fetchBranchInfo]);

  const pull = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    void (async () => {
      setIsPulling(true);
      try {
        const { gitPullCommand } = await import("../tauri-client/git");
        const result = await gitPullCommand();
        window.alert(result || "Pull successful");
        await refreshTree();
      } catch (err: unknown) {
        window.alert(`Pull failed: ${String(err)}`);
      } finally {
        fetchBranchInfo();
        setIsPulling(false);
        busyRef.current = false;
      }
    })();
  }, [fetchBranchInfo, refreshTree]);

  const push = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    void (async () => {
      setIsPushing(true);
      try {
        const { gitPushCommand } = await import("../tauri-client/git");
        const result = await gitPushCommand();
        window.alert(result || "Push successful");
      } catch (err: unknown) {
        window.alert(`Push failed: ${String(err)}`);
      } finally {
        fetchBranchInfo();
        setIsPushing(false);
        busyRef.current = false;
      }
    })();
  }, [fetchBranchInfo]);

  return {
    branch: branchInfo?.branch ?? null,
    hasUpstream: branchInfo?.hasUpstream ?? false,
    ahead: branchInfo?.ahead ?? 0,
    behind: branchInfo?.behind ?? 0,
    isPulling,
    isPushing,
    pull,
    push,
    refresh: fetchBranchInfo,
  };
}
