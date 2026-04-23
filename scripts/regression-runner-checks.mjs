import {
  assertEditorHealth,
  formatRuntimeIssues,
  withRuntimeIssueCapture,
} from "./browser-health.mjs";

function normalizeRuntimeIssueOptions(test) {
  if (test.runtimeIssues === false) {
    return null;
  }
  if (test.runtimeIssues && typeof test.runtimeIssues === "object") {
    return test.runtimeIssues;
  }
  return {};
}

function normalizeEditorHealthOptions(test) {
  if (test.editorHealth === false) {
    return null;
  }
  if (test.editorHealth && typeof test.editorHealth === "object") {
    return test.editorHealth;
  }
  return {};
}

export async function runRegressionTestWithChecks(page, test) {
  const runtimeOptions = normalizeRuntimeIssueOptions(test);
  const result = runtimeOptions
    ? await withRuntimeIssueCapture(page, () => test.run(page), runtimeOptions)
    : { value: await test.run(page), issues: [] };
  const value = result.value;
  if (value.skipped) {
    return value;
  }
  if (value.pass && result.issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues: ${formatRuntimeIssues(result.issues)}`,
    };
  }

  const healthOptions = normalizeEditorHealthOptions(test);
  if (value.pass && healthOptions) {
    await assertEditorHealth(page, `${test.name}: final`, healthOptions);
  }
  return value;
}
