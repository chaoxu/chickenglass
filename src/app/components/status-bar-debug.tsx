import { memo, useCallback, useRef, useState, type RefObject } from "react";
import { Bug } from "lucide-react";

import { cn } from "../lib/utils";
import { selectAnyDebugActive, useDevSettings, type DevSettings } from "../../state/dev-settings";
import { StatusBarPopover } from "./status-bar-popover";

const DEBUG_TOGGLE_LABELS: ReadonlyArray<readonly [keyof DevSettings, string]> = [
  ["treeView", "Tree View"],
  ["perfPanel", "Perf Panel"],
  ["fpsCounter", "FPS Counter"],
  ["commandLogging", "Command Log"],
  ["focusTracing", "Focus Tracing"],
  ["selectionAlwaysOn", "Selection Always On"],
];

interface DebugPopoverProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}

const DebugPopover = memo(function DebugPopover({ anchorRef, onClose }: DebugPopoverProps) {
  const settings = useDevSettings();

  return (
    <StatusBarPopover anchorRef={anchorRef} onClose={onClose} align="right" ariaLabel="Debug settings" minWidth="180px">
      <div className="font-semibold text-sm mb-2 text-[var(--cf-fg)]">
        Debug
      </div>
      <div className="flex flex-col gap-1.5">
        {DEBUG_TOGGLE_LABELS.map(([key, label]) => (
          <label key={String(key)} className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-[var(--cf-muted)]">{label}</span>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={() => settings.toggle(key)}
              className="accent-[var(--cf-accent,#0969da)]"
            />
          </label>
        ))}
      </div>
    </StatusBarPopover>
  );
});

export const DebugButton = memo(function DebugButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const anyActive = useDevSettings(selectAnyDebugActive);
  const closePopover = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Debug settings"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "px-1 rounded hover:bg-[var(--cf-hover)] transition-colors",
          anyActive && "text-[var(--cf-accent,#0969da)]",
        )}
      >
        <Bug size={14} />
      </button>
      {open && <DebugPopover anchorRef={btnRef} onClose={closePopover} />}
    </>
  );
});
