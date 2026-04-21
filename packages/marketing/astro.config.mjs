import { defineConfig } from "astro/config";

// GH Pages project page lives at sinameraji.github.io/tpm/. The repo
// slug on GitHub is still `tpm` — renaming the repo is a separate,
// higher-risk lift (breaks PR links + people's local clones). Base
// path matches the repo slug, not the package name.
//
// If we ever rename the repo or add a custom domain later, only these
// two lines + the BASE_URL prefixes in the templates need to change.
export default defineConfig({
  site: "https://sinameraji.github.io",
  base: "/tpm/",
  output: "static",
  build: {
    inlineStylesheets: "always",
  },
});
