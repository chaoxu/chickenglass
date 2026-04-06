import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

function readGitBuildInfo(): {
  readonly hash: string;
  readonly time: string;
} {
  try {
    const output = execSync("git log -1 --format=%h%n%cI", { encoding: "utf8" }).trim();
    const [hash = "", time = ""] = output.split("\n");
    return { hash: hash.trim(), time: time.trim() };
  } catch (error: unknown) {
    console.warn("[vite] failed to read git build info", error);
    return { hash: "", time: "" };
  }
}

export default defineConfig(({ mode }) => {
  const gitBuildInfo = readGitBuildInfo();
  return {
    plugins: [react(), tailwindcss()],
    define: {
      GIT_COMMIT_HASH: JSON.stringify(gitBuildInfo.hash),
      GIT_COMMIT_TIME: JSON.stringify(gitBuildInfo.time),
    },
    optimizeDeps: {
      include: ["katex", "pdfjs-dist", "citation-js", "@citation-js/core"],
    },
    build: {
      target: "es2022",
      sourcemap: mode === "development",
    },
  };
});
