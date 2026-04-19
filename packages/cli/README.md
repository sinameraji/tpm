# @sinameraji/tpm

**Technical Product Manager CLI.** A senior PM in your terminal. TPM audits software products by reading the **codebase** (primary source of truth) and, optionally, your public **marketing site** (auxiliary context). It never runs your product — no browser automation, no fake signups, no logins to your live app.

## Install

```bash
npm install -g @sinameraji/tpm
```

Then from any project directory:

```bash
cd your-product-repo
tpm init
tpm audit
```

First run prompts for an optional marketing URL (skip with Enter). The URL is remembered for subsequent runs.

### If `npm install -g` fails with EACCES (macOS default)

Your npm prefix points at `/usr/local/lib/node_modules`, which is root-owned. Two clean fixes — **pick one**:

**Option A (recommended, one-time, forever fix):** move npm's prefix into your home directory. After this, `npm install -g` never needs sudo for anything.

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc && source ~/.zshrc
npm install -g @sinameraji/tpm
```

**Option B (pragmatic):** prefix the install with `sudo`. Every subsequent `npm install -g` (including updating TPM) will also need sudo, which is annoying but works.

```bash
sudo npm install -g @sinameraji/tpm
```

### Don't want to install? Use npx

```bash
cd your-product-repo
npx @sinameraji/tpm@latest init
npx @sinameraji/tpm@latest audit
```

## The mental model

A skilled PM reading your codebase can narrate the user's first run from memory. TPM does the same thing, algorithmically. It extracts your routes, forms, components, copy, auth gates and tracking events — then reconstructs the intended product from the code, and a plausible user journey from the same code.

- **Codebase = source of truth.** What the code says the product does IS what the product does. It's unrealistic to run production apps locally (multiple server/infra/frontend folders, env vars, seed data, auth flows). TPM skips that entirely.
- **Marketing URL = auxiliary.** Optional. Helps TPM understand positioning (hero copy, pricing, features). When marketing and code disagree, code wins — and the divergence becomes an audit finding.

This means TPM works on anything you have source access to — enterprise SaaS, authenticated-only dashboards, anything behind a paywall — because it never needs to run or sign into your live product.

## What you get

Artifacts land in `.tpm/artifacts/{audit_id}/`:

- `map.yaml` — static code map (routes, components, forms, nav, auth providers)
- `scraped-surfaces.yaml` — marketing pages (only if a URL was provided)
- `lean-canvas.yaml` — reconstructed intent (problem, segments, UVP, JTBD, value moments)
- `paths.yaml` — imagined user journey per persona, inferred from code
- `delta.yaml` — classified gaps between intent and the code's reality
- `problems.yaml` — ranked by explicit leverage argument
- `solutions.yaml` + `prototypes/*.html` — top-5 fixes with annotated HTML mockups
- `spec.md` + `spec.html` — the PM deliverable

## Commands

```bash
tpm init                           # set up .tpm/ in the current repo
tpm audit                          # run the full six-stage audit
tpm audit --marketing-url <url>    # pre-set marketing URL, skip prompt
tpm audit --no-marketing           # skip marketing entirely
tpm audit --gateway byo            # use your own Cloudflare Workers AI
tpm report                         # show a prior audit's spec.md
tpm config get|set|show            # inspect / change config
tpm self-host                      # print the BYO setup guide
tpm cost                           # Neuron spend per audit / stage / model
```

## Hosted trial vs self-host

- **Hosted trial** (default). Every device gets **one free audit** on the maintainer's Cloudflare Workers AI credits. Zero setup.
- **Self-host** for unlimited audits. Point TPM at your own Cloudflare account (~5 min setup — you pay Cloudflare directly, typically $0.10–$0.50 per audit):

```bash
tpm config set gateway byo
tpm config set byo.account_id <your-account-id>
tpm config set byo.api_token <workers-ai-read-run-token>
tpm audit
```

Create the API token at [dash.cloudflare.com → My Profile → API Tokens](https://dash.cloudflare.com/) with `Workers AI: Read + Run` permissions.

## The six-stage method

Every audit runs the same deterministic pipeline:

1. **Intent extraction** — Lean Canvas reconstructed from the codebase (primary) + marketing (auxiliary).
2. **Imagined critical path** — user journey inferred from routes, forms, components.
3. **Delta analysis** — classifies every step and names the intent mismatches.
4. **Leverage prioritization** — ranks problems with an explicit argument, not a formula.
5. **Solution specs + prototypes** — top 5 fixes, each with a working HTML prototype.
6. **Artifact assembly** — spec.md + spec.html, PM-grade.

See [the method doc](https://github.com/sinameraji/tpm/blob/main/docs/the-method.md) for the full schema + classification taxonomies.

## Privacy

TPM runs on your machine. In hosted-trial mode, prompts flow through a Cloudflare Worker proxy — logged server-side as token counts only, not content. In BYO mode, prompts go directly from your CLI to your own Cloudflare account; nothing touches TPM infrastructure. **Source code never leaves your machine.**

## Links

- Website: [tpm-d3h.pages.dev](https://tpm-d3h.pages.dev)
- Source: [github.com/sinameraji/tpm](https://github.com/sinameraji/tpm)
- Issues: [github.com/sinameraji/tpm/issues](https://github.com/sinameraji/tpm/issues)

## Author

Built by [Sina Meraji](https://github.com/sinameraji). Contributions welcome — new extractors, patterns, prompt improvements.

- X: [@sinasanm](https://x.com/sinasanm)
- LinkedIn: [sinameraji](https://linkedin.com/in/sinameraji)

## License

[MIT](https://github.com/sinameraji/tpm/blob/main/LICENSE).
