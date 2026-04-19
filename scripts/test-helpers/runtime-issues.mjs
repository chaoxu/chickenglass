export const DEV_SERVER_RUNTIME_ISSUE_IGNORES = {
  ignoreConsole: [
    "[vite] connecting...",
    "[vite] connected.",
  ],
  ignorePageErrors: [],
};

export function issueMatches(text, patterns) {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text));
}

function mergePatternLists(left = [], right = []) {
  return [...left, ...right];
}

export function mergeRuntimeIssueOptions(...optionsList) {
  return optionsList.reduce((merged, options) => ({
    ignoreConsole: mergePatternLists(merged.ignoreConsole, options?.ignoreConsole),
    ignorePageErrors: mergePatternLists(merged.ignorePageErrors, options?.ignorePageErrors),
  }), {
    ignoreConsole: [],
    ignorePageErrors: [],
  });
}

