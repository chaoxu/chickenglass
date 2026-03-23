import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss()],
  build: {
    target: "es2022",
    sourcemap: mode === "development",
  },
}));
