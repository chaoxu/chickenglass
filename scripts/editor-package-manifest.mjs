export const EDITOR_EXTERNAL_DEPENDENCIES = Object.freeze([
  "@citation-js/core",
  "@citation-js/plugin-bibtex",
  "@citation-js/plugin-csl",
  "@codemirror/autocomplete",
  "@codemirror/commands",
  "@codemirror/lang-cpp",
  "@codemirror/lang-css",
  "@codemirror/lang-html",
  "@codemirror/lang-java",
  "@codemirror/lang-javascript",
  "@codemirror/lang-json",
  "@codemirror/lang-markdown",
  "@codemirror/lang-python",
  "@codemirror/lang-rust",
  "@codemirror/language",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@floating-ui/dom",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/markdown",
  "@radix-ui/react-context-menu",
  "clsx",
  "cmdk",
  "dompurify",
  "katex",
  "lucide-react",
  "pathe",
  "pdfjs-dist",
  "react",
  "react-dom",
  "tailwind-merge",
  "yaml",
]);

export const EDITOR_BUNDLED_DEPENDENCIES = Object.freeze([
  "@overleaf/codemirror-tree-view",
]);

export const EDITOR_FORBIDDEN_EXTERNAL_DEPENDENCIES = Object.freeze([
  "@dnd-kit/core",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",
  "@headless-tree/core",
  "@headless-tree/react",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-dialog",
  "@radix-ui/react-scroll-area",
  "@radix-ui/react-select",
  "@radix-ui/react-slider",
  "@radix-ui/react-tabs",
  "@tauri-apps/api",
  "@tauri-apps/plugin-dialog",
  "@tauri-apps/plugin-log",
  "chokidar",
  "ws",
  "zustand",
]);

const EXTERNAL_DEPENDENCY_SET = new Set(EDITOR_EXTERNAL_DEPENDENCIES);
const BUNDLED_DEPENDENCY_SET = new Set(EDITOR_BUNDLED_DEPENDENCIES);

export function packageNameFromSpecifier(specifier) {
  const [withoutQuery] = specifier.split("?", 1);
  if (!withoutQuery || withoutQuery.startsWith(".") || withoutQuery.startsWith("/")) {
    return null;
  }
  const parts = withoutQuery.split("/");
  if (withoutQuery.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : withoutQuery;
  }
  return parts[0] ?? null;
}

export function isEditorExternalDependency(specifier) {
  const packageName = packageNameFromSpecifier(specifier);
  return packageName !== null && EXTERNAL_DEPENDENCY_SET.has(packageName);
}

export function isEditorBundledDependency(specifier) {
  const packageName = packageNameFromSpecifier(specifier);
  return packageName !== null && BUNDLED_DEPENDENCY_SET.has(packageName);
}

export function isEditorBuildDependency(specifier) {
  return isEditorExternalDependency(specifier) || isEditorBundledDependency(specifier);
}
