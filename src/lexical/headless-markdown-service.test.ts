import { $getRoot } from "lexical";
import { describe, expect, it } from "vitest";

import { createHeadlessMarkdownService } from "./headless-markdown-service";
import { getLexicalMarkdown, setLexicalMarkdown } from "./markdown-io";
import { createHeadlessCoflatEditor } from "./markdown-schema";

describe("headless markdown service", () => {
  it("reuses one editor while resetting state before and after each task", () => {
    const service = createHeadlessMarkdownService(createHeadlessCoflatEditor);

    const first = service.withPooledEditor((editor) => {
      setLexicalMarkdown(editor, "# One");
      return getLexicalMarkdown(editor);
    });
    const second = service.withPooledEditor((editor) =>
      editor.getEditorState().read(() => $getRoot().getTextContent())
    );

    expect(first).toBe("# One");
    expect(second).toBe("");
    expect(service.snapshot()).toEqual({
      hasPooledEditor: true,
      pooledEditorCreateCount: 1,
      resetCount: 4,
    });
  });

  it("resets the pooled editor when a task throws", () => {
    const service = createHeadlessMarkdownService(createHeadlessCoflatEditor);

    expect(() => {
      service.withPooledEditor((editor) => {
        setLexicalMarkdown(editor, "leaked");
        throw new Error("boom");
      });
    }).toThrow("boom");

    const text = service.withPooledEditor((editor) =>
      editor.getEditorState().read(() => $getRoot().getTextContent())
    );
    expect(text).toBe("");
  });
});
