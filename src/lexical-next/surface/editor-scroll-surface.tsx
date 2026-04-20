import { createContext, useContext, type ReactNode } from "react";

const EditorScrollSurfaceContext = createContext<HTMLElement | null>(null);

export function EditorScrollSurfaceProvider({
  children,
  surface,
}: {
  readonly children: ReactNode;
  readonly surface: HTMLElement | null;
}) {
  return (
    <EditorScrollSurfaceContext.Provider value={surface}>
      {children}
    </EditorScrollSurfaceContext.Provider>
  );
}

export function useEditorScrollSurface(): HTMLElement | null {
  return useContext(EditorScrollSurfaceContext);
}

export function useRequiredEditorScrollSurface(): HTMLElement {
  const surface = useEditorScrollSurface();
  if (!surface) {
    throw new Error("Editor scroll surface is unavailable outside EditorScrollSurfaceProvider.");
  }
  return surface;
}
