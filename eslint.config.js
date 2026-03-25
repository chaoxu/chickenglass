import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: [
      "dist/",
      "node_modules/",
      "build/",
      "dist-server/",
      "src-tauri/target/",
      ".claude/worktrees/",
      "~/.chatgpt-cli/",
      "scripts/",
    ],
  },
);
