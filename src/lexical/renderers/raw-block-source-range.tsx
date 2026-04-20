import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import {
  HEADING_SOURCE_SELECTOR,
  rawBlockSourceAttrs,
  readHeadingSourcePos,
  readSourceFrom,
  readSourceTo,
  setSourceRange,
  SOURCE_BLOCK_SELECTOR,
  SOURCE_POSITION_DATASET,
} from "../source-position-contract";
import type { RawBlockVariant } from "../nodes/raw-block-node";
import { markIncrementalSourcePositionSync } from "../source-position-incremental-sync";

const RAW_BLOCK_NODE_KEY_ATTR = "data-coflat-raw-block-node-key";

export interface RawBlockSourceRange {
  readonly from: number;
  readonly to: number;
}

interface RawBlockSourceRangeHandle {
  readonly readRange: () => RawBlockSourceRange | null;
  readonly writeRange: (from: number, to: number) => void;
}

const RawBlockSourceRangeContext = createContext<RawBlockSourceRangeHandle | null>(null);

export function useRawBlockSourceRange(): RawBlockSourceRangeHandle | null {
  return useContext(RawBlockSourceRangeContext);
}

export function readRawBlockSourceRangeFromElement(element: HTMLElement): RawBlockSourceRange | null {
  const from = readSourceFrom(element);
  const to = readSourceTo(element);
  return from === null || to === null ? null : { from, to };
}

function findOwningLexicalRoot(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>(".cf-lexical-root");
}

function shiftFollowingSourceRanges(
  shell: HTMLElement,
  previousTo: number,
  delta: number,
): void {
  if (delta === 0) {
    return;
  }
  const root = findOwningLexicalRoot(shell);
  if (!root) {
    return;
  }

  const sourceBlocks = [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)]
    .filter((element) => findOwningLexicalRoot(element) === root);
  for (const element of sourceBlocks) {
    if (element === shell) {
      continue;
    }
    const from = readSourceFrom(element);
    const to = readSourceTo(element);
    if (from === null || to === null || from < previousTo) {
      continue;
    }
    setSourceRange(element, from + delta, to + delta);
  }

  const headings = [...root.querySelectorAll<HTMLElement>(HEADING_SOURCE_SELECTOR)]
    .filter((element) => findOwningLexicalRoot(element) === root);
  for (const heading of headings) {
    const pos = readHeadingSourcePos(heading);
    if (pos === null || pos < previousTo) {
      continue;
    }
    heading.dataset[SOURCE_POSITION_DATASET.headingPos] = String(pos + delta);
  }
}

export function writeRawBlockSourceRangeToElement(
  element: HTMLElement,
  from: number,
  to: number,
): void {
  const previousTo = readSourceTo(element);
  setSourceRange(element, from, to);
  if (previousTo !== null) {
    shiftFollowingSourceRanges(element, previousTo, to - previousTo);
  }
  const root = findOwningLexicalRoot(element);
  if (root) {
    markIncrementalSourcePositionSync(root);
  }
}

export function findRawBlockSourceRangeElement(
  root: HTMLElement | null,
  nodeKey: string,
): HTMLElement | null {
  if (!root) {
    return null;
  }
  return [...root.querySelectorAll<HTMLElement>(`[${RAW_BLOCK_NODE_KEY_ATTR}]`)]
    .find((element) => element.getAttribute(RAW_BLOCK_NODE_KEY_ATTR) === nodeKey) ?? null;
}

export function applyRawBlockSourceRangeChange(
  root: HTMLElement | null,
  from: number,
  to: number,
  nextTo: number,
): boolean {
  if (!root) {
    return false;
  }
  const element = [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)]
    .filter((candidate) => findOwningLexicalRoot(candidate) === root)
    .find((candidate) => readSourceFrom(candidate) === from && readSourceTo(candidate) === to);
  if (!element) {
    return false;
  }
  writeRawBlockSourceRangeToElement(element, from, nextTo);
  return true;
}

export function RawBlockSourceRangeShell({
  children,
  className,
  nodeKey,
  variant,
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly nodeKey: string;
  readonly variant: RawBlockVariant;
}) {
  const shellRef = useRef<HTMLElement | null>(null);

  const readRange = useCallback((): RawBlockSourceRange | null => {
    const shell = shellRef.current;
    if (!shell) {
      return null;
    }
    return readRawBlockSourceRangeFromElement(shell);
  }, []);

  const writeRange = useCallback((from: number, to: number) => {
    const shell = shellRef.current;
    if (shell) {
      writeRawBlockSourceRangeToElement(shell, from, to);
    }
  }, []);

  const value = useMemo((): RawBlockSourceRangeHandle => ({
    readRange,
    writeRange,
  }), [readRange, writeRange]);

  return (
    <RawBlockSourceRangeContext.Provider value={value}>
      <section
        className={className}
        data-coflat-raw-block-node-key={nodeKey}
        ref={shellRef}
        {...rawBlockSourceAttrs(variant)}
      >
        {children}
      </section>
    </RawBlockSourceRangeContext.Provider>
  );
}
