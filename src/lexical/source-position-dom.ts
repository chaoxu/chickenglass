import {
  HEADING_SOURCE_CLASS,
  readHeadingSourcePos,
  readSourceFrom,
  SOURCE_POSITION_SELECTOR,
} from "./source-position-contract";

function sourcePositionFromMarkedElement(element: HTMLElement | null): number | null {
  if (!element) {
    return null;
  }

  const sourceFrom = readSourceFrom(element);
  if (sourceFrom !== null) {
    return sourceFrom;
  }

  if (element.classList.contains(HEADING_SOURCE_CLASS)) {
    const headingPos = readHeadingSourcePos(element);
    if (headingPos !== null) {
      return headingPos;
    }
  }

  return null;
}

export function sourcePositionFromElement(element: HTMLElement | null): number | null {
  let current: HTMLElement | null = element;
  while (current) {
    const currentPosition = sourcePositionFromMarkedElement(current);
    if (currentPosition !== null) {
      return currentPosition;
    }
    current = current.parentElement;
  }

  const markedDescendant = element?.querySelector<HTMLElement>(SOURCE_POSITION_SELECTOR) ?? null;
  const descendantPosition = sourcePositionFromMarkedElement(markedDescendant);
  if (descendantPosition !== null) {
    return descendantPosition;
  }

  return null;
}

export function readSourcePositionFromElement(
  element: HTMLElement | null,
): number | null {
  return sourcePositionFromElement(element);
}
