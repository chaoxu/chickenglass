import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import type { GitBranchEntry } from "../tauri-client/git";

interface BranchSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitch: (name: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}

// Lazy-loaded to keep git client out of browser startup chunk.
const gitClient = () => import("../tauri-client/git");

export function BranchSwitcher({
  open,
  onOpenChange,
  onSwitch,
  onCreate,
}: BranchSwitcherProps): ReactNode {
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const { gitListBranchesCommand } = await gitClient();
        const result = await gitListBranchesCommand();
        setBranches(result);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        setBranches([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const handleSelect = useCallback(async (name: string) => {
    onOpenChange(false);
    try {
      await onSwitch(name);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }, [onSwitch, onOpenChange]);

  const handleCreate = useCallback(async (name: string) => {
    onOpenChange(false);
    try {
      await onCreate(name);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }, [onCreate, onOpenChange]);

  const trimmedSearch = search.trim();
  const exactMatch = branches.some((b) => b.name === trimmedSearch);
  const showCreateOption = trimmedSearch.length > 0 && !exactMatch && !loading;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="top-[20%] w-full max-w-md -translate-y-0"
    >
      <CommandInput
        placeholder="Switch or create branch..."
        value={search}
        onValueChange={setSearch}
      />

      <CommandList>
        {error ? (
          <div className="px-4 py-3 text-xs text-red-500">{error}</div>
        ) : loading ? (
          <div className="px-4 py-3 text-xs text-[var(--cf-muted)]">Loading branches...</div>
        ) : (
          <>
            <CommandEmpty>No matching branches.</CommandEmpty>

            {showCreateOption && (
              <CommandGroup heading="Create">
                <CommandItem
                  value={`create:${trimmedSearch}`}
                  onSelect={() => { void handleCreate(trimmedSearch); }}
                >
                  <span className="truncate">
                    Create branch <span className="font-semibold">{trimmedSearch}</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading="Branches">
              {branches.map((branch) => (
                <CommandItem
                  key={branch.name}
                  value={branch.name}
                  onSelect={() => {
                    if (!branch.isCurrent) {
                      void handleSelect(branch.name);
                    }
                  }}
                  disabled={branch.isCurrent}
                >
                  <span className="truncate flex items-center gap-2">
                    {branch.isCurrent && (
                      <span className="text-[var(--cf-accent)]" aria-label="current branch">*</span>
                    )}
                    {branch.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>

      <div className="border-t border-[var(--cf-border)] px-3 py-2 flex items-center gap-3 text-[10px] text-[var(--cf-muted)]">
        <span><kbd className="font-mono">↑↓</kbd> navigate</span>
        <span><kbd className="font-mono">↵</kbd> switch</span>
        <span><kbd className="font-mono">Esc</kbd> close</span>
      </div>
    </CommandDialog>
  );
}
