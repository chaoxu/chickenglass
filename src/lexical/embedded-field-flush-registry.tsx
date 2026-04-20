import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

type EmbeddedFieldFlushHandler = () => void;

export interface EmbeddedFieldFlushRegistry {
  readonly flush: () => void;
  readonly register: (handler: EmbeddedFieldFlushHandler) => () => void;
}

const EmbeddedFieldFlushContext = createContext<EmbeddedFieldFlushRegistry | null>(null);

export function createEmbeddedFieldFlushRegistry(): EmbeddedFieldFlushRegistry {
  const handlers = new Set<EmbeddedFieldFlushHandler>();
  let flushing = false;

  return {
    flush: () => {
      if (flushing) {
        return;
      }
      flushing = true;
      try {
        for (const handler of [...handlers]) {
          handler();
        }
      } finally {
        flushing = false;
      }
    },
    register: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}

export function EmbeddedFieldFlushProvider({
  children,
  registry,
}: {
  readonly children: ReactNode;
  readonly registry: EmbeddedFieldFlushRegistry;
}) {
  return (
    <EmbeddedFieldFlushContext.Provider value={registry}>
      {children}
    </EmbeddedFieldFlushContext.Provider>
  );
}

export function useEmbeddedFieldFlushRegistry(): EmbeddedFieldFlushRegistry | null {
  return useContext(EmbeddedFieldFlushContext);
}

export function useRegisterEmbeddedFieldFlush(
  handler: EmbeddedFieldFlushHandler,
  enabled: boolean,
): void {
  const registry = useEmbeddedFieldFlushRegistry();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled || !registry) {
      return;
    }
    return registry.register(() => {
      handlerRef.current();
    });
  }, [enabled, registry]);
}
