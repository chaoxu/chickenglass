import { createContext, useContext, type ReactNode } from "react";

import {
  REVEAL_PRESENTATION,
  type RevealPresentation,
} from "../app/editor-mode";

const RevealPresentationContext = createContext<RevealPresentation>(
  REVEAL_PRESENTATION.INLINE,
);

export function RevealPresentationProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: RevealPresentation;
}) {
  return (
    <RevealPresentationContext.Provider value={value}>
      {children}
    </RevealPresentationContext.Provider>
  );
}

export function useRevealPresentation(): RevealPresentation {
  return useContext(RevealPresentationContext);
}
