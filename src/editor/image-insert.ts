/**
 * Insert Image command — opens a file picker and inserts the chosen image.
 *
 * - In **browser mode**: opens an `<input type="file">` element, reads the
 *   image as a data URL, and inserts `![alt](data:...)`.
 * - In **Tauri mode**: uses Tauri's native file dialog to pick an image,
 *   copies it to the assets folder via a Rust command, and inserts
 *   `![alt](assets/filename.png)`.
 */

import type { EditorView } from "@codemirror/view";
import { isTauri } from "../app/tauri-fs";
import { isImageMime, IMAGE_MIME_EXT, fileToDataUrl } from "./image-save";
import { insertImageMarkdown } from "./image-paste";
import { frontmatterField } from "./frontmatter-state";

/** Accepted image file extensions for file dialogs. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff"];

/**
 * Open a file picker and insert the selected image into the editor.
 *
 * @param view       The CM6 EditorView to insert into.
 * @param saveImage  Callback that saves/converts the image and returns the
 *                   path to use in the markdown. Falls back to data URL.
 */
export async function insertImageFromPicker(
  view: EditorView,
  saveImage?: (file: File) => Promise<string>,
): Promise<void> {
  if (isTauri()) {
    await insertImageTauri(view);
  } else {
    await insertImageBrowser(view, saveImage);
  }
}

/**
 * Browser mode: open an `<input type="file">` element and read the image.
 */
async function insertImageBrowser(
  view: EditorView,
  saveImage?: (file: File) => Promise<string>,
): Promise<void> {
  const save = saveImage ?? fileToDataUrl;

  return new Promise<void>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(",") + ",image/*";
    input.style.display = "none";

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve();
        return;
      }

      if (!isImageMime(file.type)) {
        console.warn("[chickenglass] Selected file is not a supported image type:", file.type);
        resolve();
        return;
      }

      const ext = IMAGE_MIME_EXT[file.type] ?? "png";
      const baseName = file.name || `image-${Date.now()}.${ext}`;

      save(file)
        .then((path) => {
          const alt = baseName.replace(/\.[^.]+$/, "");
          insertImageMarkdown(view, path, alt);
          view.focus();
          resolve();
        })
        .catch((err: unknown) => {
          console.error("[chickenglass] image insert failed:", err);
          resolve();
        });
    });

    // Handle cancel (user closes the dialog without selecting)
    input.addEventListener("cancel", () => {
      resolve();
    });

    document.body.appendChild(input);
    input.click();
    // Clean up the input element after a delay
    setTimeout(() => {
      input.remove();
    }, 60000);
  });
}

/**
 * Tauri mode: use the native file dialog to pick an image, then copy it
 * into the project's asset folder via the Rust `copy_file_to_project` command.
 */
async function insertImageTauri(view: EditorView): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: IMAGE_EXTENSIONS,
        },
      ],
    });

    if (!selected) return; // User cancelled

    const sourcePath = selected as string;
    const fileName = sourcePath.split("/").pop() ?? sourcePath.split("\\").pop() ?? sourcePath;
    const alt = fileName.replace(/\.[^.]+$/, "");

    // Read the imageFolder from frontmatter (or default to "assets")
    const fm = view.state.field(frontmatterField, false);
    const imageFolder = fm?.config.imageFolder ?? "assets";

    // Get the docPath from the window global (set by use-editor)
    // The docPath is available as a data attribute on the editor DOM
    // For now, we determine the target relative path within the project
    const destPath = `${imageFolder}/${fileName}`;

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("copy_file_to_project", {
      source: sourcePath,
      dest: destPath,
    });

    // Insert the relative path (imageFolder/filename)
    insertImageMarkdown(view, destPath, alt);
    view.focus();
  } catch (err: unknown) {
    console.error("[chickenglass] Image file picker failed:", err);
  }
}
