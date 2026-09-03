import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const emotionIsPropValidShim = {
    name: "emotion-is-prop-valid-browser-shim",
    renderChunk(code: string) {
      return code.replaceAll(
        'require("@emotion/is-prop-valid").default',
        "(() => true)",
      );
    },
  };

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/api": {
          target: "http://127.0.0.1:5020",
          changeOrigin: true,
        },
        "/uploads": {
          target: "http://127.0.0.1:5020",
          changeOrigin: true,
        },
      },
    },
    plugins: [react(), emotionIsPropValidShim, mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
