# M18 — Jinba Dogfood Protocol

The goal of M18 is to run a full end-to-end audit against Jinba and compare the output against Sina's pre-written findings. This is the go/no-go for shipping v1.

## Prerequisites (Sina)

Before the dogfood run, the handoffs from earlier milestones need to be completed:

1. **Cloudflare backend deployed** (M3):

   ```bash
   cd packages/backend
   wrangler d1 create tpm-prod
   wrangler kv namespace create SESSIONS
   wrangler kv namespace create RATE_LIMITS
   wrangler r2 bucket create tpm-artifacts
   # copy the IDs into wrangler.toml
   wrangler d1 migrations apply tpm-prod
   wrangler secret put JWT_SECRET
   wrangler deploy
   ```

   Point `tpm-api.sina-b35.workers.dev/*` at the deployed worker via a Cloudflare route on the `tpm.pages.dev` zone.

2. **Stripe live mode (optional for dogfood)**: can run dogfood with local free-tier only; quota's lifetime=1 is enough for a single audit. Real Stripe lands at M20 launch.

3. **Playwright browser**:

   ```bash
   npx playwright install chromium
   ```

4. **Sina's pre-written Jinba findings**: a text file with what Sina already believes about Jinba's top problems. Kept off-repo (e.g. `~/jinba-findings-pre-audit.md`).

## Running the dogfood audit

```bash
cd ~/path/to/jinba-repo   # run from inside Jinba's codebase
pnpm --filter @tpm/cli build   # or npm install -g tpm once published
node /path/to/tpm/packages/cli/dist/bin/tpm.js init
node /path/to/tpm/packages/cli/dist/bin/tpm.js audit https://jinba.ai
```

Artifacts land in `.tpm/artifacts/{audit_id}/`:

- `map.yaml` — static code map
- `scraped-surfaces.yaml` — marketing pages
- `lean-canvas.yaml` — intent (open in `$EDITOR` to correct)
- `paths.yaml` — per-persona observed paths
- `delta.yaml` — classified deltas
- `problems.yaml` — ranked problems
- `solutions.yaml` + `prototypes/*.html`
- `spec.md` + `spec.pdf`

## Sign-off criteria

Sina signs off on M18 if and only if:

1. **Quality**: TPM's top 3 problems match or beat Sina's pre-written findings on Jinba. "Beat" means TPM surfaces something Sina missed that survives review.
2. **Method**: each stage's YAML is valid, replayable, and the classifications (step_classification, friction_flags) are applied correctly.
3. **Cost**: total neurons within 20% of $0.50 target. Expected breakdown:
   - Stage A: ~$0.10
   - Stage B: ~$0.15 (≈20-40 navigator calls × 2 personas)
   - Stage C: ~$0.10
   - Stage D: ~$0.05
   - Stage E: ~$0.08 (5 solutions × 2 calls each)
   - Stage F: ~$0.02
4. **Time-to-report**: under 10 minutes from `tpm audit` to `spec.pdf` for a mid-sized SaaS. Under 20 minutes is acceptable.

## Iteration rules

If the audit disappoints, iterate the **weakest stage** only — don't rewrite everything. Typical weak-spot diagnoses:

- **Stage A hallucinates**: tighten the system prompt's evidence rule, lower temperature, re-run with `--resume-from A`.
- **Stage B gets stuck**: adjust friction-flag taxonomy prompt examples, increase step_budget for complex flows.
- **Stage C misclassifies**: add a pattern to built-in.yaml that captures the missed case; rerun Stage C.
- **Stage D ranks wrong**: the leverage argument rule-set in prompt needs tightening. Sina reviews the generated arguments and patches the system prompt.

Once Sina signs off:

```bash
# Lock the model config
cat > ~/.tpm/config.yaml <<EOF
models:
  heavy: "@cf/openai/gpt-oss-120b"
  navigator: "@cf/qwen/qwen3-30b-a3b-fp8"
  prototype: "@cf/qwen/qwen3-30b-a3b-fp8"
EOF
```

M18 is done. M19 (launch readiness) is the last prep step before M20 (launch).
