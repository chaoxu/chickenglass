import { describe, expectTypeOf, it } from "vitest";

import type { NativeExportFormat } from "../lib/types";
import { exportDocumentCommand } from "./export";

describe("native export command contract", () => {
  it("only accepts backend-supported native export formats", () => {
    type ExportDocumentArgs = Parameters<typeof exportDocumentCommand>;
    type CommandFormat = ExportDocumentArgs[1];
    type CommandOptions = ExportDocumentArgs[4];

    expectTypeOf<CommandFormat>().toEqualTypeOf<NativeExportFormat>();
    expectTypeOf<Extract<CommandFormat, "html">>().toEqualTypeOf<never>();
    expectTypeOf<CommandOptions>().toEqualTypeOf<
      | {
          readonly bibliography?: string;
          readonly template?: string;
        }
      | undefined
    >();
  });
});
