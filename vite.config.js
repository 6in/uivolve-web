import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
  build: { target: "es2022" },
  test: { include: ["tests/**/*.test.js"] },
  fmt: { ignorePatterns: ["engine/target/**", "dist/**", "bun.lock"] },
  lint: { ignorePatterns: ["engine/target/**", "dist/**"] },
});
