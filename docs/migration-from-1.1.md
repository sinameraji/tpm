# Migrating from PM 1.1.x to 1.2.0

1.2.0 replaces Cloudflare Workers AI with Anthropic (BYO key) and deletes the hosted backend. If you used any 1.1.x build, this is what changes.

## TL;DR

```bash
npm install -g @sinameraji/pm@latest    # pulls 1.2.0 once it's published
pm init                                  # paste your Anthropic API key, pick tier
cd your-product-repo
pm audit
```

That's the full migration.

## What PM detects automatically

`pm audit` on a machine that has a 1.1.x `~/.pm/config.yaml` (with `gateway`, `api_endpoint`, or `byo.*` keys) sees the old shape and acts:

- **TTY:** prints _"Cloudflare Workers AI support was removed in 1.2.0. PM now uses your own Anthropic API key."_ and offers to run `pm init` inline (`Y/n`).
- **Non-TTY (CI, piped):** same message, points to `pm init`, exits 0 with no side effects.

PM never rewrites your config without permission.

`~/.pm/tokens.json` (the old device-flow JWT bundle) is silently deleted on the first successful 1.2.0 audit.

## What breaks if you don't `pm init`

- `pm audit` refuses to start — there's no fallback inference path. You'll get a clear message pointing to `pm init`.
- `pm self-host` is gone. If your scripts reference it, replace with `pm init`.
- `pm config set gateway byo` is a no-op (the flag is read tolerantly but ignored). The only gateway is Anthropic now.
- `--endpoint`, `--gateway`, `--no-sync` flags on `pm audit` are removed.

## What doesn't break

- Existing `.tpm/` directories in your repos keep working. SQLite schema is unchanged; old audit history is readable by `pm report`.
- `spec.md` from a 1.1.x audit still opens with `pm report <id>`.
- Artifact layout on disk (`.pm/artifacts/<audit-id>/*.yaml`) is unchanged.

## Cost differences

v1.1.x ran on your Cloudflare Workers AI account (or the maintainer's hosted trial for a single free audit). v1.2.0 runs on your Anthropic account at Anthropic's published rates (see [anthropic.com/pricing](https://www.anthropic.com/pricing)).

Roughly: a fast-tier audit runs ~$1-3 per run; deep-tier 3-5× that. The first audit on a fresh machine costs a bit more than subsequent ones because the ephemeral prompt cache isn't warm yet. Cache warms up in ~5 minutes and persists between back-to-back audits on the same repo.

## Self-host no longer exists

There's nothing to self-host in 1.2.0. The backend package is deleted. If you were running your own Cloudflare Worker for 1.1.x, you can take it down — it's no longer referenced.

## Downgrading

`npm install -g @sinameraji/pm@1.1.4` still works if you hit a blocker in 1.2.0 — file an issue with the repro and we'll fix before promoting beta → latest. Your local `~/.pm/config.yaml` is tolerated by both versions; the keys 1.1.x needs (`gateway`, `api_endpoint`, `byo.*`) are preserved in the `legacy` block by 1.2.0, not rewritten.
