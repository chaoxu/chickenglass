const BACKSLASH = "\\".charCodeAt(0);
const DOLLAR = "$".charCodeAt(0);

function isWhitespaceCode(code: number): boolean {
  return code >= 0 && /\s/u.test(String.fromCodePoint(code));
}

function isDigitCode(code: number): boolean {
  return code >= "0".charCodeAt(0) && code <= "9".charCodeAt(0);
}

export function isPandocDollarMathOpener(nextCode: number): boolean {
  return nextCode >= 0
    && nextCode !== DOLLAR
    && !isWhitespaceCode(nextCode);
}

export function isPandocDollarMathCloser(
  previousCode: number,
  nextCode: number,
): boolean {
  return previousCode >= 0
    && !isWhitespaceCode(previousCode)
    && !isDigitCode(nextCode);
}

export function isBackslashEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (text.charCodeAt(cursor) !== BACKSLASH) break;
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
