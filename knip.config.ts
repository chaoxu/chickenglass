import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "src/main.tsx",
    "editor.ts",
    "src/editor/index.ts",
    "src/app/index.ts",
    "src/test-setup.ts",
    "scripts/*.mjs",
    "scripts/regression-tests/*.mjs",
    "vite.config.ts",
    "vite.editor.config.ts",
    "vitest.config.ts",
    "knip.config.ts",
  ],
  project: ["src/**/*.{ts,tsx}", "editor.ts", "scripts/**/*.mjs"],
  ignore: [
    "src-tauri/**",
    "demo/**",
    ".worktrees/**",
    "dist/**",
  ],
  ignoreBinaries: ["sleep", "wait", "python3"],
  ignoreDependencies: [
    // Installed for hook-level tests (#707), not yet used
    "@testing-library/react",
    "@testing-library/jest-dom",
    // Tauri CLI — invoked via shell, not imported
    "@tauri-apps/cli",
    // Tailwind — used via @tailwindcss/vite plugin, not imported directly
    "tailwindcss",
    // Type-only packages
    "@types/dompurify",
    "@types/katex",
    "@types/node",
    "@types/react",
    "@types/react-dom",
  ],
};

export default config;
