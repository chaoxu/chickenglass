import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TableNode } from "./nodes/table-node";

const TABLE_SELECTOR = ".cf-lexical-table-block";
const SCROLL_THRESHOLD = 2;

function computeScrollEdge(el: HTMLElement): "left" | "right" | "both" | null {
  const maxScroll = el.scrollWidth - el.clientWidth;
  if (maxScroll <= SCROLL_THRESHOLD) {
    return null;
  }
  const atLeft = el.scrollLeft <= SCROLL_THRESHOLD;
  const atRight = el.scrollLeft >= maxScroll - SCROLL_THRESHOLD;
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
  if (edge) {
    table.dataset.scrollEdge = edge;
  } else {
    delete table.dataset.scrollEdge;
  }
}

export function TableScrollShadowPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const tracked = new Map<HTMLElement, () => void>();
    let rootElement: HTMLElement | null = null;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (target === rootElement) {
          // Root resized — re-check all tables for overflow changes
          for (const table of tracked.keys()) {
            syncScrollState(table);
          }
        } else if (tracked.has(target)) {
          syncScrollState(target);
        }
      }
    });

    function attach(table: HTMLElement): void {
      if (tracked.has(table)) {
        return;
      }
      const onScroll = () => {
        syncScrollState(table);
      };
      table.addEventListener("scroll", onScroll, { passive: true });
      resizeObserver.observe(table);
      syncScrollState(table);
      tracked.set(table, onScroll);
    }

    function detach(table: HTMLElement): void {
      const handler = tracked.get(table);
      if (handler) {
        table.removeEventListener("scroll", handler);
        resizeObserver.unobserve(table);
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

    const unregisterRootListener = editor.registerRootListener(
      (nextRoot, prevRoot) => {
        if (prevRoot) {
          resizeObserver.unobserve(prevRoot);
          for (const table of tracked.keys()) {
            detach(table);
          }
        }
        rootElement = nextRoot;
        if (nextRoot) {
          resizeObserver.observe(nextRoot);
          scanAll(nextRoot);
        }
      },
    );

    // Only rescan tables when table nodes are added/removed, not on every keystroke.
    const unregisterMutationListener = editor.registerMutationListener(
      TableNode,
      () => {
        const root = editor.getRootElement();
        if (root) {
          scanAll(root);
        }
      },
    );

    return () => {
      unregisterRootListener();
      unregisterMutationListener();
      resizeObserver.disconnect();
      for (const table of tracked.keys()) {
        detach(table);
      }
    };
  }, [editor]);

  return null;
}
