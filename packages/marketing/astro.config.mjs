import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://tpm-d3h.pages.dev",
  output: "static",
  build: {
    inlineStylesheets: "always",
  },
});
