import { memo } from "react";
import { Settings } from "lucide-react";

import { cn } from "../lib/utils";

interface ConfigButtonProps {
  readonly onOpenSettings?: () => void;
}

export const ConfigButton = memo(function ConfigButton({ onOpenSettings }: ConfigButtonProps) {
  return (
    <button
      type="button"
      aria-label="Editor settings"
      onClick={onOpenSettings}
      disabled={!onOpenSettings}
      className={cn(
        "px-1 rounded hover:bg-[var(--cf-hover)] transition-colors",
        !onOpenSettings && "opacity-50 cursor-not-allowed",
      )}
    >
      <Settings size={14} />
    </button>
  );
});
