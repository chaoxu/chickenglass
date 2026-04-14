/**
 * editability-context — Boolean editable flag for the current Lexical surface.
 *
 * Separated from LexicalRenderContext because editable changes rarely (mode
 * switch) while render context changes on every document edit. Keeping them
 * apart avoids unnecessary rerenders of renderers that only check editability.
 *
 * The four editor-subsystem contexts and their update frequencies:
 * - LexicalRenderContext: per-keystroke (doc, citations, config)
 * - LexicalSurfaceEditabilityContext: per-mode-switch (boolean)
 * - StructureEditContext: per-activation (active structure edit)
 * - EditorScrollSurfaceContext: per-mount (DOM element ref)
 */
import { createContext, useContext, type ReactNode } from "react";

const LexicalSurfaceEditabilityContext = createContext(true);

export function LexicalSurfaceEditableProvider({
  children,
  editable,
}: {
  readonly children: ReactNode;
  readonly editable: boolean;
}) {
  return (
    <LexicalSurfaceEditabilityContext.Provider value={editable}>
      {children}
    </LexicalSurfaceEditabilityContext.Provider>
  );
}

export function useLexicalSurfaceEditable(): boolean {
  return useContext(LexicalSurfaceEditabilityContext);
}
