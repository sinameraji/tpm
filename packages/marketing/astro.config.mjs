import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://usetpm.dev",
  output: "static",
  build: {
    inlineStylesheets: "always",
  },
});
