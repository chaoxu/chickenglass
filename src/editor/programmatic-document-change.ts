import { Annotation } from "@codemirror/state";

/**
 * Marks full-document programmatic replacements dispatched by the app.
 *
 * These are not direct user edits, so structural protection filters such as
 * table/fence guards must let them through.
 */
export const programmaticDocumentChangeAnnotation = Annotation.define<true>();
