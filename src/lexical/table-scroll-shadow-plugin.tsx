import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

const TABLE_SELECTOR = ".cf-lexical-table-block";
const SCROLL_THRESHOLD = 2;

type ScrollEdge = "left" | "right" | "both" | "none";

function computeScrollEdge(el: HTMLElement): ScrollEdge {
  const maxScroll = el.scrollWidth - el.clientWidth;
  if (maxScroll <= SCROLL_THRESHOLD) {
    return "none";
  }
  const atLeft = el.scrollLeft <= SCROLL_THRESHOLD;
  const atRight = el.scrollLeft >= maxScroll - SCROLL_THRESHOLD;
  if (atLeft && atRight) {
    return "none";
  }
  if (atLeft) {
    return "left";
  }
  if (atRight) {
    return "right";
  }
  return "both";
}

function syncScrollState(table: HTMLElement): void {
  const edge = computeScrollEdge(table);
  if (edge === "none") {
    delete table.dataset.scrollEdge;
  } else {
    table.dataset.scrollEdge = edge;
  }
}

export function TableScrollShadowPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const tracked = new Map<HTMLElement, () => void>();

    function attach(table: HTMLElement): void {
      if (tracked.has(table)) {
        return;
      }

      const onScroll = () => {
        syncScrollState(table);
      };

      table.addEventListener("scroll", onScroll, { passive: true });
      syncScrollState(table);
      tracked.set(table, onScroll);
    }

    function detach(table: HTMLElement): void {
      const handler = tracked.get(table);
      if (handler) {
        table.removeEventListener("scroll", handler);
        tracked.delete(table);
      }
    }

    function scanAll(root: HTMLElement): void {
      const tables = root.querySelectorAll<HTMLElement>(TABLE_SELECTOR);
      const current = new Set<HTMLElement>();

      for (const table of tables) {
        attach(table);
        current.add(table);
      }

      for (const table of tracked.keys()) {
        if (!current.has(table)) {
          detach(table);
        }
      }
    }

    function resyncAll(): void {
      for (const table of tracked.keys()) {
        syncScrollState(table);
      }
    }

    const rootElement = editor.getRootElement();
    if (rootElement) {
      scanAll(rootElement);
    }

    const resizeObserver = new ResizeObserver(() => {
      resyncAll();
    });

    if (rootElement) {
      resizeObserver.observe(rootElement);
    }

    const unregisterRootListener = editor.registerRootListener(
      (nextRoot, prevRoot) => {
        if (prevRoot) {
          resizeObserver.unobserve(prevRoot);
          for (const table of tracked.keys()) {
            detach(table);
          }
        }
        if (nextRoot) {
          resizeObserver.observe(nextRoot);
          scanAll(nextRoot);
        }
      },
    );

    const unregisterUpdateListener = editor.registerUpdateListener(() => {
      const root = editor.getRootElement();
      if (root) {
        scanAll(root);
        for (const table of tracked.keys()) {
          resizeObserver.observe(table);
        }
      }
    });

    return () => {
      unregisterRootListener();
      unregisterUpdateListener();
      resizeObserver.disconnect();
      for (const table of tracked.keys()) {
        detach(table);
      }
    };
  }, [editor]);

  return null;
}
