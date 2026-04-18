# Launch Checklist

Everything that must be true before `pnpm publish` and DNS cutover.

## Code

- [ ] `pnpm typecheck` green across all packages
- [ ] `pnpm lint` green
- [ ] `pnpm format:check` green
- [ ] `pnpm test` green, ≥60 tests total
- [ ] `pnpm --filter @tpm/cli build && node packages/cli/dist/bin/tpm.js --help` succeeds

## Backend (Cloudflare)

- [ ] `wrangler d1 create tpm-prod` + database_id in `wrangler.toml`
- [ ] `wrangler kv namespace create SESSIONS` + id in `wrangler.toml`
- [ ] `wrangler kv namespace create RATE_LIMITS` + id in `wrangler.toml`
- [ ] `wrangler r2 bucket create tpm-artifacts`
- [ ] `wrangler d1 migrations apply tpm-prod`
- [ ] `wrangler secret put JWT_SECRET` (long random)
- [ ] `wrangler secret put STRIPE_SECRET_KEY` (live mode)
- [ ] `wrangler secret put STRIPE_WEBHOOK_SECRET`
- [ ] `wrangler deploy` succeeds
- [ ] Route `api.usetpm.dev/*` added to the `usetpm.dev` zone
- [ ] `curl https://api.usetpm.dev/health` returns `{ok:true}`

## Stripe

- [ ] Live-mode account active
- [ ] Product "TPM Pro" with price `price_pro_monthly` @ $20/month recurring
- [ ] Product "TPM Team" with price `price_team_seat_monthly` @ $49/seat/month
- [ ] Webhook endpoint `https://api.usetpm.dev/billing/webhook` subscribed to:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- [ ] Test a $20 test-mode purchase end-to-end; license upgrades in D1

## Marketing (Cloudflare Pages)

- [ ] Pages project created pointing at `packages/marketing/`
- [ ] Build command: `pnpm install && pnpm --filter @tpm/marketing build`
- [ ] Output dir: `packages/marketing/dist`
- [ ] Custom domain `usetpm.dev` attached
- [ ] SSL cert issued
- [ ] /, /pricing, /docs, /upgrade, /privacy, /terms all load

## NPM

- [ ] `packages/cli/package.json` version bumped + public (remove `"private": true` when ready)
- [ ] `files` field lists `dist`, `bin`, `src/patterns/built-in.yaml`
- [ ] `npm whoami` on the publishing machine matches a TPM-authorized user
- [ ] 2FA enabled on npm account
- [ ] Dry run: `npm publish --dry-run --workspace=@tpm/cli`
- [ ] Tag: `git tag v1.0.0 && git push --tags`
- [ ] Publish: `pnpm --filter @tpm/cli publish --access public`
- [ ] Verify: `npx tpm@latest --help` on a fresh machine

## GitHub

- [ ] Release notes on the tag describing v1.0.0
- [ ] Status badge in README (CI)
- [ ] `.github/workflows/ci.yml` green on the release commit

## Post-launch monitoring

- [ ] Uptime monitor on `api.usetpm.dev/health` (UptimeRobot or Cloudflare)
- [ ] Error rate alarm on Worker (Cloudflare Analytics)
- [ ] Stripe dashboard configured for daily email digest
- [ ] support@usetpm.dev inbox monitored

## Rollback plan

- [ ] Prior Worker version can be rolled back with `wrangler rollback`
- [ ] Prior NPM version deprecation: `npm deprecate @tpm/cli@1.0.0 "bug, use 1.0.1"`
- [ ] Pages previous deploy restorable from the Cloudflare dashboard
