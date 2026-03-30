import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "src/app/main.tsx",
    "editor.ts",
    "src/editor/index.ts",
    "src/app/index.ts",
    "scripts/*.mjs",
    "scripts/regression-tests/*.mjs",
  ],
  project: ["src/**/*.{ts,tsx}", "editor.ts", "scripts/**/*.mjs"],
  ignoreBinaries: ["sleep", "wait", "python3"],
  ignoreDependencies: [
    // Tauri CLI — invoked via shell, not imported
    "@tauri-apps/cli",
    // Tailwind — used via @tailwindcss/vite plugin, not imported directly
    "tailwindcss",
    // Type-only packages
    "@types/dompurify",
    "@types/katex",
    // Added for hook-level tests (#707); not yet imported in test files
    "@testing-library/react",
  ],
  // Focus on unused files and missing deps; skip unused-export noise from
  // barrel re-exports (226 UI component re-exports are expected by design).
  include: ["files", "dependencies", "unlisted"],
};

export default config;
