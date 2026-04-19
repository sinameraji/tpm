import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://tpm.pages.dev",
  output: "static",
  build: {
    inlineStylesheets: "always",
  },
});
