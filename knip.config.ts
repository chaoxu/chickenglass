import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "src/app/index.ts",
    "editor.ts",
    "scripts/*.mjs",
    "scripts/regression-tests/*.mjs",
  ],
  project: ["src/**/*.{ts,tsx}", "scripts/**/*.mjs"],
  ignoreDependencies: [
    // Tauri CLI — invoked via shell, not imported
    "@tauri-apps/cli",
    // Tailwind — used via @tailwindcss/vite plugin, not imported directly
    "tailwindcss",
    // Type-only packages
    "@types/dompurify",
    "@types/katex",
  ],
  // Focus on unused files and missing deps; skip unused-export noise from
  // barrel re-exports (226 UI component re-exports are expected by design).
  include: ["files", "dependencies", "unlisted"],
};

export default config;
