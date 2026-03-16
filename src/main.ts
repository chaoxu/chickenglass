import { App, createDemoFileSystem } from "./app";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app element");
}

const fs = createDemoFileSystem();
const app = new App({ root, fs });
app.init("main.md");
