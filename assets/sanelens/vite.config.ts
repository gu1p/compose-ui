import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { mockApiPlugin } from "./tools/mock-api";

export default defineConfig(({ mode }) => {
  const plugins = [svelte()];
  if (mode === "mock") {
    plugins.push(mockApiPlugin());
  }

  return {
    plugins,
    build: {
      outDir: "dist",
      emptyOutDir: true,
      assetsDir: "",
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          entryFileNames: "app.js",
          assetFileNames: (assetInfo) => {
            if (!assetInfo.name) {
              return "asset";
            }
            if (assetInfo.name === "style.css") {
              return "styles.css";
            }
            return assetInfo.name;
          },
        },
      },
    },
  };
});
