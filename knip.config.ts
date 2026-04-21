import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "editor.ts",
    "src/editor/index.ts",
    "src/app/index.ts",
    "scripts/*.mjs",
    "scripts/regression-tests/*.mjs",
  ],
  project: ["src/**/*.{ts,tsx}", "scripts/**/*.mjs"],
  ignoreDependencies: [
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
