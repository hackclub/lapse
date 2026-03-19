import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { resolve } from "node:path";

// These deps ship ESM-only or are workspace packages that output ESM.
// Bundle them instead of externalizing so Electron's CJS main process
// can consume them without ERR_REQUIRE_ESM.
const bundledDeps = [
  "@hackclub/lapse-api",
  "@hackclub/lapse-shared",
  "@orpc/client",
  "@orpc/contract",
  "@orpc/openapi-client"
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledDeps })],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src")
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          captureWindow: resolve(__dirname, "src/main/capture/captureWindow.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          capturePreload: resolve(__dirname, "src/main/capture/capturePreload.ts")
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src")
      }
    },
    css: {
      postcss: {
        plugins: [tailwindcss()]
      }
    }
  }
});
