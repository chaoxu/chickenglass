import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    hookTimeout: 30_000,
    setupFiles: ["./src/test-setup.ts"],
    teardownTimeout: 10_000,
    testTimeout: 60_000,
    exclude: [
      "**/node_modules/**",
      "**/target/**",
      "**/.worktrees/**",
      "**/.claude/worktrees/**",
    ],
  },
});
