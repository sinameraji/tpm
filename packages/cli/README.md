# @sinameraji/tpm

**Technical Product Manager CLI.** A senior PM in your terminal. TPM audits software products by reading the **codebase** (primary source of truth) and, optionally, your public **marketing site** (auxiliary context). It never runs your product — no browser automation, no fake signups, no logins to your live app.

## Install

```bash
npm install -g @sinameraji/tpm
```

Then:

```bash
tpm init       # paste your Anthropic API key (stored at ~/.tpm/config.yaml, chmod 600)
cd your-product-repo
tpm audit
```

TPM uses **Claude (Sonnet 4.6 by default)** for inference. You bring your own Anthropic API key — your key, your rate limits, your bill. A typical audit takes 8–12 minutes and costs roughly $1–3 in Anthropic API credits at your account's rates. See [anthropic.com/pricing](https://www.anthropic.com/pricing) for the latest rates.

First-run flow prompts for the key and a default tier (fast / deep). Subsequent `tpm audit` runs optionally prompt for a marketing URL (skip with Enter); the URL is remembered per project.

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
tpm init                               # initialize .tpm/ + walk you through key + tier
tpm audit                              # run the full six-stage audit
tpm audit --marketing-url <url>        # pre-set marketing URL, skip prompt
tpm audit --no-marketing               # skip marketing entirely
tpm audit --no-stream                  # disable the streaming progress UI (CI)
tpm report                             # show a prior audit's spec.md / spec.html
tpm config get|set|unset|show          # inspect / change config
tpm config set model-tier deep         # switch to Opus on B-model/C/E-spec/F
tpm config set stage_models.c claude-opus-4-7   # per-stage override
tpm cost                               # what your audits cost, in USD
tpm feedback                           # how to send feedback
```

## Model tiers + BYO

Pick a tier on `tpm init`:

- **fast** (default) — Sonnet 4.6 throughout. ~8–12 min, ~$1–3 per audit.
- **deep** — Opus 4.7 on B-model, C, E-spec, F; Sonnet on the rest. ~18–25 min, ~$6–10.

Switch later with `tpm config set model-tier deep`. Override individual stages with `tpm config set stage_models.<stage> <model>`.

Your Anthropic key lives in `~/.tpm/config.yaml` (chmod 600) and only ever travels to `api.anthropic.com`. `tpm config show` masks it (`sk-ant-…XYZ9`). Remove it with `tpm config unset anthropic-key`. Env var `ANTHROPIC_API_KEY` overrides the config file when set.

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

TPM runs entirely on your machine. Prompts go directly to `api.anthropic.com` using your API key — there is no TPM-operated backend, no analytics, no phone-home. Your source code never leaves your machine except as inference prompts you can inspect with `tpm audit --verbose`.

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
