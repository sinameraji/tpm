# Self-host TPM

TPM is open source. The default `tpm audit` hits our hosted Cloudflare Worker at `tpm-api.sina-b35.workers.dev`, which gives every device one free audit on the maintainer's Workers AI credits. After that, self-host on your own Cloudflare — 5 minutes of setup.

## Why self-host?

- **Unlimited audits.** Only Cloudflare's meter, no TPM quota.
- **Privacy.** Prompts go directly from your CLI to your Cloudflare account. Our infra sees nothing.
- **Control.** Pin specific Workers AI model versions, customize allowlists, add your own telemetry.

## 1. Cloudflare account

1. Sign up at https://dash.cloudflare.com/sign-up (free).
2. Enable Workers AI (no explicit opt-in — it's on the free plan by default).
3. Copy your **Account ID** from the right sidebar of any Cloudflare dashboard page.

## 2. API token

1. Go to **My Profile → API Tokens → Create Token**.
2. Use the **Custom token** template.
3. Permissions:
   - `Workers AI` → `Read`
   - `Workers AI` → `Run`
4. Account resources: `Include → [your account]`.
5. Create + copy the token (shown once).

## 3. Configure TPM

```bash
tpm config set gateway byo
tpm config set byo.account_id <your-account-id>
tpm config set byo.api_token <your-api-token>
tpm config show
```

The token is stored in `~/.tpm/config.yaml` with mode 0600 and is only read by the CLI — never synced anywhere.

## 4. Run audits

```bash
tpm audit https://your-product.com
```

Cost is printed after every run. Expect ~$0.10–$0.50 per full audit depending on product complexity.

## Switch back to the hosted trial

```bash
tpm config set gateway hosted
```

Useful if you want to compare outputs or the hosted service happens to have a fresher model build.

## Optional: per-stage model override

```bash
tpm config set byo.models.heavy "@cf/openai/gpt-oss-120b"
tpm config set byo.models.navigator "@cf/qwen/qwen3-30b-a3b-fp8"
tpm config set byo.models.prototype "@cf/qwen/qwen3-30b-a3b-fp8"
```

Only override if you know what you're doing — the defaults are calibrated for the method's schema constraints.
