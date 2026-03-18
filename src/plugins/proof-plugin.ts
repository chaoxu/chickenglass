/**
 * Proof block plugin.
 *
 * Proofs are unnumbered and render with "Proof" (or "Proof (of Theorem 1)")
 * as the header. The QED symbol (∎) is appended to the header suffix
 * to indicate completion.
 */

import type { BlockPlugin } from "./plugin-types";
import { createBlockRender } from "./block-render";

/** The default QED symbol appended to proof blocks. */
export const QED_SYMBOL = "\u220E"; // ∎

export const proofPlugin: BlockPlugin = {
  name: "proof",
  numbered: false,
  title: "Proof",
  render: createBlockRender("Proof"),
  defaults: { qedSymbol: QED_SYMBOL },
};
