import { memo } from "react";
import type { DiagnosticEntry } from "../diagnostics";

interface DiagnosticsProps {
  diagnostics: DiagnosticEntry[];
  onSelect: (from: number) => void;
}

export const Diagnostics = memo(function Diagnostics({
  diagnostics,
  onSelect,
}: DiagnosticsProps) {
  if (diagnostics.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cf-muted)] italic">
        No diagnostics
      </div>
    );
  }

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.length - errorCount;

  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[10px] text-[var(--cf-muted)] font-mono tabular-nums">
        {errorCount > 0 && <span>{errorCount} error{errorCount !== 1 ? "s" : ""}</span>}
        {errorCount > 0 && warningCount > 0 && <span> &middot; </span>}
        {warningCount > 0 && <span>{warningCount} warning{warningCount !== 1 ? "s" : ""}</span>}
      </div>
      {diagnostics.map((diag, i) => (
        <button
          key={i}
          className="flex items-baseline gap-1.5 w-full text-left px-3 py-[2px] text-sm hover:bg-[var(--cf-hover)] transition-colors duration-[var(--cf-transition,0.15s)] cursor-pointer"
          onClick={() => onSelect(diag.from)}
        >
          <span
            className="shrink-0 w-[6px] h-[6px] rounded-full self-center"
            style={{
              backgroundColor:
                diag.severity === "error"
                  ? "var(--cf-error, #e53e3e)"
                  : "var(--cf-warning, #d69e2e)",
            }}
          />
          <span className="text-[var(--cf-fg)] truncate min-w-0 cf-ui-font">
            {diag.message}
          </span>
        </button>
      ))}
    </div>
  );
});
