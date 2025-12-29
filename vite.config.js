import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/contenteditable-playground/",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        contenteditable: resolve(__dirname, "contenteditable-playground.html"),
        dynamic: resolve(__dirname, "dynamic-contenteditable-playground.html")
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
