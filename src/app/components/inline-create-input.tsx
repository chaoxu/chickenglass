import { useState, useRef, useEffect, useCallback } from "react";
import type { KeyboardEvent } from "react";
import { File, FolderClosed } from "lucide-react";

type CreateKind = "file" | "folder";

const ICON_SIZE = 14;
const ICON_CLASS = "shrink-0 text-[var(--cf-muted)]";

interface InlineCreateInputProps {
  kind: CreateKind;
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function InlineCreateInput({ kind, depth, onConfirm, onCancel }: InlineCreateInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const indent = depth * 12 + 8;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  }, [onCancel, onConfirm, value]);

  const handleKey = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
    [commit, onCancel],
  );

  return (
    <div
      className="flex items-center gap-1 px-2 py-[2px] text-sm text-[var(--cf-fg)] whitespace-nowrap"
      style={{ paddingLeft: `${indent}px` }}
    >
      {kind === "folder" ? (
        <FolderClosed size={ICON_SIZE} className={ICON_CLASS} />
      ) : (
        <File size={ICON_SIZE} className={ICON_CLASS} />
      )}
      <input
        ref={inputRef}
        type="text"
        placeholder={kind === "folder" ? "Folder name" : "File name"}
        className="flex-1 text-sm cf-ui-font bg-[var(--cf-bg)] border border-[var(--cf-border)] rounded px-1 outline-none min-w-0"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKey}
        onBlur={onCancel}
      />
    </div>
  );
}
