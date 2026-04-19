import { describe, expect, it } from "vitest";

import {
  extractReplayActions,
  summarizeSessionEvents,
} from "./browser-repro.mjs";

describe("browser-repro session replay extraction", () => {
  it("replays interaction-trace clicks and beforeinput events", () => {
    const events = [
      {
        type: "click",
        detail: {
          button: 0,
          clientX: 40,
          clientY: 50,
          editorX: 10,
          editorY: 20,
        },
      },
      {
        type: "input",
        detail: {
          data: "x",
          inputType: "insertText",
        },
      },
      {
        type: "input",
        detail: {
          data: null,
          inputType: "deleteContentBackward",
        },
      },
    ];

    expect(extractReplayActions(events)).toEqual({
      actions: [
        {
          button: 0,
          clientX: 40,
          clientY: 50,
          editorX: 10,
          editorY: 20,
          modifiers: [],
          type: "click",
        },
        {
          text: "x",
          type: "insertText",
        },
        {
          key: "Backspace",
          modifiers: [],
          type: "press",
        },
      ],
      skipped: 0,
    });
  });

  it("uses editor context as a comparable capture when no explicit snapshot exists", () => {
    const summary = summarizeSessionEvents([
      {
        type: "input",
        context: {
          editor: {
            docHash: "12345678",
            docLength: 12,
            excerpt: { from: 0, text: "hello world", to: 11 },
            selection: { anchor: 5, focus: 5, from: 5, to: 5 },
          },
          mode: "lexical",
        },
        detail: {
          data: "!",
          inputType: "insertText",
        },
      },
    ]);

    expect(summary.captureSource).toBe("context");
    expect(summary.lastContext.editor).toMatchObject({
      docHash: "12345678",
      docLength: 12,
    });
    expect(summary.replayableActionCount).toBe(1);
  });
});
