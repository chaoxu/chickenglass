import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

interface StructureSourceEditorProps {
  readonly className: string;
  readonly doc: string;
  readonly multiline?: boolean;
  readonly onChange: (nextValue: string) => void;
  readonly onClose: () => void;
}

export function StructureSourceEditor({
  className,
  doc,
  multiline = false,
  onChange,
  onClose,
}: StructureSourceEditorProps) {
  const [draft, setDraft] = useState(() => doc);
  const originalDocRef = useRef(doc);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const field = multiline ? textareaRef.current : inputRef.current;
    if (!field) {
      return;
    }
    field.focus();
    const end = draft.length;
    field.setSelectionRange(end, end);
  }, []);

  useEffect(() => {
    if (doc === originalDocRef.current) {
      return;
    }

    originalDocRef.current = doc;
    setDraft(doc);
  }, [doc]);

  const closeWithRevert = useCallback(() => {
    if (draft !== originalDocRef.current) {
      onChange(originalDocRef.current);
      setDraft(originalDocRef.current);
    }
    onClose();
  }, [draft, onChange, onClose]);

  const handleKeyDown = useCallback((
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWithRevert();
      return;
    }

    if (!multiline && event.key === "Enter") {
      event.preventDefault();
      onClose();
    }
  }, [closeWithRevert, multiline, onClose]);

  const commonProps = {
    className,
    onBlur: () => onClose(),
    onChange: (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const nextValue = event.currentTarget.value;
      setDraft(nextValue);
      onChange(nextValue);
    },
    onKeyDown: handleKeyDown,
    spellCheck: false,
    value: draft,
  } as const;

  return multiline ? (
    <textarea {...commonProps} ref={textareaRef} />
  ) : (
    <input {...commonProps} ref={inputRef} />
  );
}
