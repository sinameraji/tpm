#!/usr/bin/env bash
# Release script for TPM (OSS). Usage: scripts/release.sh <version>
# Example: scripts/release.sh 1.0.0
#
# Steps:
#   1. Preflight (typecheck / lint / format / test / build)
#   2. Deploy hosted-trial backend (tpm-api.sina-b35.workers.dev) — skip with --skip-backend
#   3. Build marketing site (Cloudflare Pages pulls from packages/marketing/dist)
#   4. Publish CLI to npm as `tpm` (public)
#   5. Tag + push
#
# Pre-reqs: logged into wrangler, logged into npm (2FA device ready),
# repo is clean.

set -euo pipefail

VERSION="${1:-}"
SKIP_BACKEND=0
for arg in "$@"; do
  [ "$arg" = "--skip-backend" ] && SKIP_BACKEND=1
done

if [ -z "$VERSION" ]; then
  echo "Usage: scripts/release.sh <version> [--skip-backend]"
  exit 1
fi

echo "==> 1/5  preflight"
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build

if [ "$SKIP_BACKEND" -eq 0 ]; then
  echo "==> 2/5  deploy backend"
  pnpm --filter @tpm/backend run deploy
else
  echo "==> 2/5  skip backend (--skip-backend)"
fi

echo "==> 3/5  build marketing"
pnpm --filter @tpm/marketing run build

echo "==> 4/5  publish CLI to npm (@latest)"
pnpm --filter tpm publish --access public --no-git-checks

echo "==> 5/5  tag + push"
git tag "v${VERSION}"
git push --tags

echo ""
echo "✓ Release v${VERSION} complete."
echo "  Verify:"
echo "    curl https://tpm-api.sina-b35.workers.dev/health"
echo "    npx tpm@latest --help"
