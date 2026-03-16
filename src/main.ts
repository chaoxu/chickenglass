import { createEditor } from "./editor";

const container = document.getElementById("editor-container");
if (!container) {
  throw new Error("Missing #editor-container element");
}

createEditor({ parent: container });
