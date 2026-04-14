import { memo, useCallback, useRef, useState, type RefObject } from "react";
import { Settings } from "lucide-react";

import { useAppWorkspaceController } from "../contexts/app-workspace-context";
import { cn } from "../lib/utils";
import type { Theme } from "../theme-manager";
import { StatusBarPopover } from "./status-bar-popover";

const THEME_OPTIONS: ReadonlyArray<readonly [Theme, string]> = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "System"],
];

interface ConfigPopoverProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}

const ConfigPopover = memo(function ConfigPopover({ anchorRef, onClose }: ConfigPopoverProps) {
  const { settings, updateSetting } = useAppWorkspaceController();

  return (
    <StatusBarPopover anchorRef={anchorRef} onClose={onClose} align="right" ariaLabel="Editor settings" minWidth="160px">
      <div className="font-semibold text-sm mb-2 text-[var(--cf-fg)]">
        Settings
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[var(--cf-muted)] text-xs mb-0.5">Theme</div>
        {THEME_OPTIONS.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="cf-theme"
              value={value}
              checked={settings.theme === value}
              onChange={() => updateSetting("theme", value)}
              className="accent-[var(--cf-accent,#0969da)]"
            />
            <span className="text-[var(--cf-muted)]">{label}</span>
          </label>
        ))}
      </div>
    </StatusBarPopover>
  );
});

export const ConfigButton = memo(function ConfigButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const closePopover = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Editor settings"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "px-1 rounded hover:bg-[var(--cf-hover)] transition-colors",
          open && "bg-[var(--cf-hover)]",
        )}
      >
        <Settings size={14} />
      </button>
      {open && <ConfigPopover anchorRef={btnRef} onClose={closePopover} />}
    </>
  );
});
