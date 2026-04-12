// Ambient module declarations for third-party libraries that ship without
// TypeScript types, plus Vite-specific import suffixes.

declare module "*.css?inline" {
  const css: string;
  export default css;
}

declare module "markdown-it";
declare module "markdown-it-attrs";
declare module "markdown-it-footnote";
declare module "markdown-it-mark";
declare module "markdown-it-task-lists";
declare module "markdown-it-texmath";

declare module "lucide-react/dist/esm/icons/copy.js" {
  export const __iconNode: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;
}

declare module "lucide-react/dist/esm/icons/check.js" {
  export const __iconNode: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;
}
