export {
  hoistMathMacros,
  liftFencedDivTitles,
  promoteLabeledDisplayMath,
  renderMathMacros,
} from "./preprocess-core.mjs";
import {
  preprocessWithReadFile,
} from "./preprocess-core.mjs";

export function preprocess(markdown) {
  return preprocessWithReadFile(markdown);
}
