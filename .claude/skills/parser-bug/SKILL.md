---
name: parser-bug
description: Investigate and fix Lezer parser bugs using the test-first workflow. Write a Vitest test, fix the parser, then verify in the browser for incremental parsing issues.
---

# Parser Bug Workflow

Test-first workflow for investigating and fixing Lezer markdown parser bugs.

## Step 1: Reproduce with a Vitest test

Write a failing test with the exact document content that triggers the bug. Place the test next to the relevant parser source file (`foo.ts` -> `foo.test.ts`).

```ts
import { describe, it, expect } from 'vitest';
// Import the relevant parser setup

describe('bug description', () => {
  it('should handle the specific case', () => {
    const doc = `exact markdown content that triggers the bug`;
    // Parse and assert expected tree structure
  });
});
```

Run the test to confirm it fails:
```
npm run test -- --run path/to/file.test.ts
```

## Step 2: Root-cause analysis

Use the Lezer syntax tree, not regex. Key tools:
- Tree walking to understand how the parser sees the document
- `__cmDebug.treeString()` in the browser for visual tree inspection
- Check `endLeaf` callbacks, composite block boundaries, generation counters

Read `docs/architecture/development-rules.md` for Lezer parser rules (composite boundary checks, `packValue`, `closeFenceNode` guards).

## Step 3: Fix

Apply the smallest clean fix at the correct architectural layer:
- Prefer fixing the parser extension over patching downstream consumers
- Check adjacent cases and duplicated code paths
- If the architecture is wrong, fix that instead

## Step 4: Verify the test passes

```
npm run test -- --run path/to/file.test.ts
```

## Step 5: Check for incremental parsing issues

Vitest tests only check cold parsing. Incremental parsing (editing a live document) can behave differently. Verify in the browser:

1. Use the `/browser-verify` skill to connect via CDP
2. Open a file containing the bug's document content
3. Edit near the bug site and check that the tree stays correct:
   ```js
   await page.evaluate(() => __cmDebug.treeString());
   ```
4. Specifically check that fenced div generation counters prevent stale fragment reuse

## Step 6: Add regression coverage

Add tests for the bug class, not just the exact repro:
- Boundary conditions (empty content, nested blocks, adjacent blocks)
- Incremental edit scenarios if applicable
- Related syntax that exercises the same code path

## References

- Lezer parser rules: `docs/architecture/development-rules.md`
- Parser extensions: `src/parser/`
- Fenced div composite: `src/parser/fenced-div.ts`
- Equation labels: `src/parser/equation-label.ts`
