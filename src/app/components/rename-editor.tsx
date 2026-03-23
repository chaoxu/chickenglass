import { useRef, useEffect, useCallback } from "react";
import type { KeyboardEvent } from "react";

interface RenameEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * Inline rename input — auto-focuses, selects all text, and commits on Enter
 * or cancels on Escape/blur.
 */
export function RenameEditor({ value, onChange, onCommit, onCancel }: RenameEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleKey = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onCommit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
    [onCommit, onCancel],
  );

  return (
    <input
      ref={inputRef}
      type="text"
      autoFocus
      className="flex-1 text-sm cf-ui-font bg-[var(--cf-bg)] border border-[var(--cf-border)] rounded px-1 outline-none min-w-0"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKey}
      onBlur={onCancel}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
