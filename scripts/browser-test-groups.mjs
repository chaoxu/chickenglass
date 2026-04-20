function splitCsv(value) {
  return value
    ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

export function normalizeBrowserTestGroups(file, groups) {
  if (!Array.isArray(groups)) {
    throw new Error(`${file}: missing groups export. Add "export const groups = [...]" next to the test name.`);
  }

  const normalized = [...new Set(groups.map((group) => {
    if (typeof group !== "string") {
      throw new Error(`${file}: browser test groups must be strings.`);
    }
    return group.trim();
  }).filter(Boolean))];

  if (normalized.length === 0) {
    throw new Error(`${file}: browser test must declare at least one group.`);
  }

  return normalized;
}

export function buildBrowserTestGroups(tests) {
  const groups = new Map();
  for (const test of tests) {
    for (const groupName of normalizeBrowserTestGroups(test.file ?? test.name, test.groups)) {
      const group = groups.get(groupName) ?? [];
      group.push(test.name);
      groups.set(groupName, group);
    }
  }

  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function expandBrowserTestSelection({
  tests,
  filterArg = "",
  groupArg = "",
}) {
  const availableTestNames = tests.map((test) => test.name);
  const available = new Set(availableTestNames);
  const groups = buildBrowserTestGroups(tests);
  const requested = new Set();
  const unknownGroups = [];
  const unknownTests = [];

  for (const groupName of splitCsv(groupArg)) {
    const groupTests = groups[groupName];
    if (!groupTests) {
      unknownGroups.push(groupName);
      continue;
    }
    for (const testName of groupTests) {
      requested.add(testName);
    }
  }

  for (const testName of splitCsv(filterArg)) {
    requested.add(testName);
  }

  if (requested.size === 0) {
    return {
      selected: availableTestNames,
      unknownGroups,
      unknownTests,
    };
  }

  const selected = [];
  for (const testName of requested) {
    if (available.has(testName)) {
      selected.push(testName);
    } else {
      unknownTests.push(testName);
    }
  }

  return {
    selected,
    unknownGroups,
    unknownTests,
  };
}

export function formatBrowserTestList(tests) {
  const lines = ["Available browser regression tests:"];
  for (const test of tests) {
    const groups = normalizeBrowserTestGroups(test.file ?? test.name, test.groups);
    lines.push(`  ${test.name} [${groups.join(", ")}]`);
  }

  const groups = buildBrowserTestGroups(tests);
  lines.push("", "Groups:");
  for (const [name, testNames] of Object.entries(groups)) {
    lines.push(`  ${name}: ${testNames.join(", ")}`);
  }
  return lines.join("\n");
}
