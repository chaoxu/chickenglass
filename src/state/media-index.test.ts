import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { documentPathFacet } from "../lib/types";
import {
  collectChangedLocalMediaPathsFromIndex,
  localMediaReferenceRangesForResolvedPaths,
  localMediaReferences,
  localMediaReferencesForResolvedPaths,
  mediaIndexField,
} from "./media-index";

function createState(
  doc: string,
  extensions = [documentPathFacet.of("posts/math.md")],
): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown(), ...extensions, mediaIndexField],
  });
}

describe("mediaIndexField", () => {
  it("indexes local image and PDF references and ignores non-local sources", () => {
    const doc = [
      "![fig](figures/a.png)",
      "![paper](paper.pdf)",
      "![remote](https://example.com/a.png)",
      "![data](data:image/png;base64,abc)",
      "![blob](blob:abc)",
    ].join("\n\n");
    const state = createState(doc);
    const refs = localMediaReferences(state.field(mediaIndexField));

    expect(refs.map((ref) => ({
      text: state.sliceDoc(ref.from, ref.to),
      src: ref.src,
      resolvedPath: ref.resolvedPath,
      cacheKind: ref.cacheKind,
    }))).toEqual([
      {
        text: "![fig](figures/a.png)",
        src: "figures/a.png",
        resolvedPath: "posts/figures/a.png",
        cacheKind: "image",
      },
      {
        text: "![paper](paper.pdf)",
        src: "paper.pdf",
        resolvedPath: "posts/paper.pdf",
        cacheKind: "pdf",
      },
    ]);
  });

  it("maps references across prose edits away from images", () => {
    let state = createState("Intro\n\n![fig](fig.png)\n");
    const before = localMediaReferences(state.field(mediaIndexField))[0];

    state = state.update({ changes: { from: 0, insert: "Draft " } }).state;
    const after = localMediaReferences(state.field(mediaIndexField))[0];

    expect(after.from).toBe(before.from + "Draft ".length);
    expect(after.to).toBe(before.to + "Draft ".length);
    expect(after.src).toBe("fig.png");
    expect(after.resolvedPath).toBe("posts/fig.png");
  });

  it("updates only the dirty image reference when source syntax changes", () => {
    const doc = [
      "![first](first.png)",
      "",
      "![second](second.png)",
    ].join("\n");
    let state = createState(doc);
    const sourceFrom = doc.indexOf("first.png");

    state = state.update({
      changes: {
        from: sourceFrom,
        to: sourceFrom + "first.png".length,
        insert: "paper.pdf",
      },
    }).state;

    expect(localMediaReferences(state.field(mediaIndexField)).map((ref) => ({
      src: ref.src,
      resolvedPath: ref.resolvedPath,
      cacheKind: ref.cacheKind,
    }))).toEqual([
      { src: "paper.pdf", resolvedPath: "posts/paper.pdf", cacheKind: "pdf" },
      { src: "second.png", resolvedPath: "posts/second.png", cacheKind: "image" },
    ]);
  });

  it("keeps duplicate path fanout until each matching reference is removed", () => {
    let state = createState("![a](same.png)\n\n![b](same.png)");
    const path = "posts/same.png";

    expect(
      localMediaReferencesForResolvedPaths(state.field(mediaIndexField), new Set([path])),
    ).toHaveLength(2);

    state = state.update({ changes: { from: 0, to: 1, insert: "x" } }).state;
    expect(
      localMediaReferencesForResolvedPaths(state.field(mediaIndexField), new Set([path])),
    ).toHaveLength(1);

    const secondBang = state.doc.toString().lastIndexOf("!");
    state = state.update({ changes: { from: secondBang, to: secondBang + 1, insert: "x" } }).state;
    expect(
      localMediaReferencesForResolvedPaths(state.field(mediaIndexField), new Set([path])),
    ).toHaveLength(0);
  });

  it("returns every range for a matching cache path", () => {
    const state = createState("![a](same.png)\n\n![b](same.png)\n\n![c](other.png)");

    const ranges = localMediaReferenceRangesForResolvedPaths(
      state.field(mediaIndexField),
      new Set(["posts/same.png"]),
    );

    expect(ranges.map((range) => state.sliceDoc(range.from, range.to))).toEqual([
      "![a](same.png)",
      "![b](same.png)",
    ]);
  });

  it("collects changed cache paths from indexed local references", () => {
    const state = createState("![fig](fig.png)\n\n![paper](paper.pdf)");
    const index = state.field(mediaIndexField);
    const oldPdf = new Map([["posts/paper.pdf", { status: "loading" }]]);
    const newPdf = new Map([["posts/paper.pdf", { status: "ready" }]]);
    const oldImage = new Map([["posts/fig.png", { status: "loading" }]]);
    const newImage = new Map([
      ["posts/fig.png", oldImage.get("posts/fig.png")],
      ["posts/untracked.png", { status: "ready" }],
    ]);

    expect([
      ...collectChangedLocalMediaPathsFromIndex(
        index,
        oldPdf,
        newPdf,
        oldImage,
        newImage,
      ),
    ]).toEqual(["posts/paper.pdf"]);
  });

  it("rebuilds resolved paths when the document path facet changes", () => {
    const docPath = new Compartment();
    let state = createState("![fig](fig.png)", [
      docPath.of(documentPathFacet.of("posts/math.md")),
    ]);

    state = state.update({
      effects: docPath.reconfigure(documentPathFacet.of("notes/physics.md")),
    }).state;

    expect(localMediaReferences(state.field(mediaIndexField)).map((ref) => ref.resolvedPath))
      .toEqual(["notes/fig.png"]);
  });
});
