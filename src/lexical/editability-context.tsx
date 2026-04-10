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
