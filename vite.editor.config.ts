import { copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";
import {
  EDITOR_FORBIDDEN_EXTERNAL_DEPENDENCIES,
  isEditorBuildDependency,
  isEditorBundledDependency,
  isEditorExternalDependency,
  packageNameFromSpecifier,
} from "./scripts/editor-package-manifest.mjs";

function copyEditorCss(): Plugin {
  return {
    name: "copy-editor-css",
    closeBundle() {
      const katexCss = readFileSync("node_modules/katex/dist/katex.min.css", "utf8");
      const editorCss = readFileSync("src/editor-theme.css", "utf8");
      writeFileSync("dist/editor.css", `${katexCss}\n${editorCss}`);
      cpSync("node_modules/katex/dist/fonts", "dist/fonts", { recursive: true });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    copyEditorCss(),
    // Run `npm run build:analyze` to generate dist/stats.html bundle treemap
    mode === "analyze" &&
      visualizer({
        filename: "dist/stats.html",
        open: true,
        gzipSize: true,
        brotliSize: true,
      }),
  ],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("./editor.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "editor.mjs",
    },
    rolldownOptions: {
      external: (id) => {
        if (id.includes("?inline") || id.endsWith(".css")) {
          return false;
        }

        const packageName = packageNameFromSpecifier(id);
        if (packageName && EDITOR_FORBIDDEN_EXTERNAL_DEPENDENCIES.includes(packageName)) {
          throw new Error(
            `The standalone editor build imported app-only dependency ${packageName}.`,
          );
        }

        if (packageName && !isEditorBuildDependency(id)) {
          throw new Error(
            `The standalone editor build imported ${packageName}, which is not listed in scripts/editor-package-manifest.mjs.`,
          );
        }

        if (isEditorBundledDependency(id)) {
          return false;
        }

        return isEditorExternalDependency(id);
      },
      output: {
        codeSplitting: false,
      },
    },
  },
}));
