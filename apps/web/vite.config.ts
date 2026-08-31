import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: { environment: "jsdom" },
  server: {
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
