function sourcePositionFromMarkedElement(element: HTMLElement | null): number | null {
  if (!element) {
    return null;
  }

  const sourceFrom = element.dataset.coflatSourceFrom;
  if (sourceFrom !== undefined) {
    const parsed = Number(sourceFrom);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (element.classList.contains("cf-lexical-heading")) {
    const headingPos = element.dataset.coflatHeadingPos;
    if (headingPos !== undefined) {
      const parsed = Number(headingPos);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

export function sourcePositionFromElement(element: HTMLElement | null): number | null {
  const markedDescendant = element?.querySelector<HTMLElement>(
    "[data-coflat-source-from], .cf-lexical-heading[data-coflat-heading-pos]",
  ) ?? null;
  const descendantPosition = sourcePositionFromMarkedElement(markedDescendant);
  if (descendantPosition !== null) {
    return descendantPosition;
  }

  let current: HTMLElement | null = element;
  while (current) {
    const currentPosition = sourcePositionFromMarkedElement(current);
    if (currentPosition !== null) {
      return currentPosition;
    }
    current = current.parentElement;
  }
  return null;
}

export function readSourcePositionFromElement(
  element: HTMLElement | null,
): number | null {
  return sourcePositionFromElement(element);
}
