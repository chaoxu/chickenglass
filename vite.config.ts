import { execSync } from "node:child_process";
import { defineConfig } from "vite";
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
    plugins: [tailwindcss()],
    define: {
      GIT_COMMIT_HASH: JSON.stringify(gitBuildInfo.hash),
      GIT_COMMIT_TIME: JSON.stringify(gitBuildInfo.time),
    },
    build: {
      target: "es2022",
      sourcemap: mode === "development",
    },
  };
});
