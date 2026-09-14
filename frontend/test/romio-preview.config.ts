import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [vue()],
  define: { "process.env": {} },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "@v2": fileURLToPath(new URL("../src/v2", import.meta.url)),
    },
  },
  server: { host: "127.0.0.1", port: 4318, strictPort: true },
});
