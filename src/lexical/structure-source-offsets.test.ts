import { describe, expect, it } from "vitest";

import {
  footnoteDefinitionBodyOffsetToRawOffset,
  footnoteDefinitionRawOffsetToBodyOffset,
} from "./structure-source-offsets";

describe("structure source offsets", () => {
  it("maps footnote continuation indentation between raw source and displayed body", () => {
    const raw = [
      "[^note]: First line",
      "  second line",
      "    third line",
    ].join("\n");

    const secondRaw = raw.indexOf("second") + 3;
    const thirdRaw = raw.indexOf("third") + 2;

    expect(footnoteDefinitionRawOffsetToBodyOffset(raw, secondRaw)).toBe("First line\nsec".length);
    expect(footnoteDefinitionRawOffsetToBodyOffset(raw, thirdRaw)).toBe("First line\nsecond line\nth".length);
    expect(footnoteDefinitionBodyOffsetToRawOffset(raw, "First line\nsec".length)).toBe(secondRaw);
    expect(footnoteDefinitionBodyOffsetToRawOffset(raw, "First line\nsecond line\nth".length)).toBe(thirdRaw);
  });
});
