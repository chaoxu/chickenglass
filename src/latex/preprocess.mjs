import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export {
  hoistMathMacros,
  liftFencedDivTitles,
  promoteLabeledDisplayMath,
  renderMathMacros,
  stripFrontmatter,
} from "./preprocess-core.mjs";
import {
  preprocessWithReadFile,
  resolveIncludesWithReadFile,
} from "./preprocess-core.mjs";

function resolveNodeIncludePath(sourcePath, targetPath) {
  return resolve(dirname(sourcePath), targetPath);
}

function nodeIncludeOptions() {
  return {
    pathKey: (path) => resolve(path),
    readFile: (path) => readFile(path, "utf8"),
    resolvePath: resolveNodeIncludePath,
  };
}

export function resolveIncludes(markdown, sourcePath) {
  return resolveIncludesWithReadFile(markdown, sourcePath, nodeIncludeOptions());
}

export function preprocess(markdown, sourcePath) {
  return preprocessWithReadFile(markdown, sourcePath, nodeIncludeOptions());
}
