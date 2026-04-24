import { useCallback } from "react";
import type { DragEvent } from "react";

export interface EditorDropOpenDeps {
  openFileWithContent: (name: string, content: string) => Promise<void>;
}

export interface EditorDropOpenController {
  handleDragOver: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => void;
}

export function useEditorDropOpen({
  openFileWithContent,
}: EditorDropOpenDeps): EditorDropOpenController {
  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    for (const file of files) {
      if (file.name.endsWith(".md")) {
        void file.text().then((text) => {
          openFileWithContent(file.name, text);
        });
      }
    }
  }, [openFileWithContent]);

  return {
    handleDragOver,
    handleDrop,
  };
}
