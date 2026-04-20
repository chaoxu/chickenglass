export {
  hoistMathMacros,
  renderMathMacros,
} from "./preprocess-core.mjs";
import {
  preprocessWithReadFile,
} from "./preprocess-core.mjs";

export function preprocess(markdown, sourcePath) {
  return preprocessWithReadFile(markdown, sourcePath);
}
