import { defineConfig } from "vite-plus";

// Public demo assets. Protected production endpoints must also validate JWTs.
const cors = {
  origin: "*",
  methods: ["GET", "HEAD", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  credentials: false,
};

export default defineConfig({
  base: "/",
  server: { host: "127.0.0.1", port: 4173, strictPort: true, cors },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true, cors },
  build: { target: "es2022" },
  test: { include: ["tests/**/*.test.js"] },
  fmt: {
    ignorePatterns: ["engine/target/**", "dist/**", "runtime-dist/**", "app-dist/**", "bun.lock"],
  },
  lint: { ignorePatterns: ["engine/target/**", "dist/**", "runtime-dist/**", "app-dist/**"] },
});
