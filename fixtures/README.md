# Fixtures

`fixtures/` holds regression, heavy, and otherwise non-public documents used by
browser scripts, performance harnesses, and focused debug work.

Rules:

- Do not treat `fixtures/` as public showcase content.
- `fixtures/` is local-only by default and ignored by git. Do not rely on it
  for tracked product/demo content.
- Keep `demo/` limited to intentionally generated public showcase files.
- When browser scripts need a fixture, use the shared fixture helpers in
  `scripts/test-helpers.mjs` instead of hardcoding `demo/` paths.
