import type { Command } from "commander";
import { bootstrap, emit, emitText } from "./_runtime.js";

const GUIDE_URL = "https://tpm-d3h.pages.dev/self-host";

const SELF_HOST_GUIDE = `
TPM is open source. The hosted backend at tpm-api.sina-b35.workers.dev gives every device
ONE free audit on the maintainer's Cloudflare Workers AI credits. After
that, run TPM on your own account:

  1. Sign up at cloudflare.com (free) and enable Workers AI in the dashboard.
  2. Create an API token with "Workers AI: Read + Run" permissions.
  3. Configure the CLI to use your credentials:

       tpm config set gateway byo
       tpm config set byo.account_id <your-account-id>
       tpm config set byo.api_token <your-api-token>

  4. Run audits from inside your repo. The codebase (cwd) feeds Stage A's
     Lean Canvas; the URL argument is the deployed product TPM walks:

       cd your-product-repo
       tpm audit https://your-product.com

     Omit the URL for a code-only audit (Stage A only, no browser walk).
     Use --project /path/to/repo to override the codebase location.

Docs: ${GUIDE_URL}
Source: https://github.com/sinameraji/tpm
`;

export function register(program: Command): void {
  program
    .command("self-host")
    .aliases(["upgrade", "activate", "account"])
    .description("Print the self-hosting guide — run unlimited audits on your own Cloudflare.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      emitText(runtime, SELF_HOST_GUIDE.trim());
      emit(runtime, { ok: true, guide_url: GUIDE_URL });
    });
}
