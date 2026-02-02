import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import legacy from "@vitejs/plugin-legacy";
import devtools from "solid-devtools/vite";
import hexColorTransform from "@lightningtv/vite-hex-transform";
import path from "path";

export default defineConfig(({ mode }) => ({
  define: {
    __DEV__: mode !== "production",
    "import.meta.env.VITE_STREAM_BASE_URL": JSON.stringify(
      "http://YOUR_BASE_URL"
    ),
    "import.meta.env.VITE_STREAM_USERNAME": JSON.stringify("YOUR_USERNAME"),
    "import.meta.env.VITE_STREAM_PASSWORD": JSON.stringify("YOUR_PASSWORD")
  },
  plugins: [
    hexColorTransform({
      include: ["src/**/*.{ts,tsx,js,jsx}"]
    }),
    devtools({
      autoname: true,
      locator: {
        jsxLocation: true,
        componentLocation: true,
        targetIDE: "vscode"
      }
    }),
    solidPlugin({
      solid: {
        moduleName: "@lightningtv/solid",
        generate: "universal",
        builtIns: []
      }
    }),
    legacy({
      // Tizen 5.5 is roughly Chrome 63; targeting 49 is safer for older models
      //targets: ["chrome >= 49", "not IE 11"],
      targets: ["chrome >= 49"],
      additionalLegacyPolyfills: ["whatwg-fetch"],
      // Forces the TV to use legacy code instead of trying incompatible modern ESM
      renderModernChunks: false,
      modernPolyfills: ["es.global-this"]
    })
  ],
  build: {
    // Standardizing the build target for the TV browser
    target: "es2015",
    // Terser is required for better legacy transpilation
    minify: "terser",
    terserOptions: {
      compress: {
        keep_fnames: true, // Prevents function name mangling that breaks the renderer
        keep_classnames: true
      }
    },
    sourcemap: false,
    outDir: "tizen",
    emptyOutDir: false
  },
  resolve: {
    alias: {
      theme: path.resolve(__dirname, "src/theme.ts")
    },
    conditions: ["@lightningtv/source"],
    dedupe: [
      "solid-js",
      "solid-js/universal",
      "@solidjs/router",
      "@lightningjs/renderer",
      "@lightningtv/core",
      "@lightningtv/solid",
      "@lightningtv/solid/primitives"
    ]
  },
  optimizeDeps: {
    exclude: [
      "@lightningtv/solid",
      "@lightningtv/core",
      "@lightningjs/renderer"
    ]
  },
  server: {
    port: 5174,
    hmr: true,
    proxy: {
      "/get_categories": {
        target: "http://172.20.3.54:8000",
        changeOrigin: true
      },
      "/categories": {
        target: "http://172.20.3.54:8000",
        changeOrigin: true
      },
      "/get_plot": {
        target: "http://172.20.3.54:8000",
        changeOrigin: true
      },
      "/tmdb-image": {
        target: "https://image.tmdb.org/t/p",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tmdb-image/, "")
      }
    }
  }
}));
