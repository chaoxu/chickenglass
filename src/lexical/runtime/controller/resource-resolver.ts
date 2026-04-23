import { useMemo } from "react";

import {
  createLexicalRenderResourceResolver,
  type LexicalRenderResourceResolver,
  type ProjectTextFileReader,
} from "./resource-resolver-core";

export {
  createLexicalRenderResourceResolver,
  type LexicalRenderResourceResolver,
  type ProjectTextFileReader,
} from "./resource-resolver-core";

export function useLexicalRenderResourceResolver(
  fs: ProjectTextFileReader,
  docPath?: string,
): LexicalRenderResourceResolver {
  return useMemo(() => createLexicalRenderResourceResolver(fs, docPath), [docPath, fs]);
}
