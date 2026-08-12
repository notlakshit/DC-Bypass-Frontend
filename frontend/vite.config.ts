import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

// Static SPA build for GitHub Pages.
// - base: "./" makes asset URLs relative to index.html, so the build works at
//   https://<user>.github.io/ AND https://<user>.github.io/<repo>/ without
//   hardcoding a sub-path.
// - Routing uses hash history (see src/router.tsx), so deep links and refresh
//   never hit GitHub Pages' 404 (there is no server to rewrite URLs).
export default defineConfig({
  base: "./",
  plugins: [TanStackRouterVite(), react(), tailwindcss(), tsconfigPaths()],
  build: {
    outDir: "dist",
  },
});
