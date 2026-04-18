#!/usr/bin/env bash
# Release script for TPM v1. Follows the launch checklist.
# This is a manual, one-click release — each step is explicit and fails fast.

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: scripts/release.sh <version>"
  echo "Example: scripts/release.sh 1.0.0"
  exit 1
fi

echo "==> 1/6  pre-flight: typecheck + lint + format + test"
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test

echo "==> 2/6  build all packages"
pnpm build

echo "==> 3/6  deploy backend (api.usetpm.dev)"
pnpm --filter @tpm/backend run deploy

echo "==> 4/6  build marketing"
pnpm --filter @tpm/marketing run build

echo "==> 5/6  publish CLI to npm"
pnpm --filter tpm publish --access public --no-git-checks

echo "==> 6/6  tag + push"
git tag "v${VERSION}"
git push --tags

echo ""
echo "✓ Release v${VERSION} complete."
echo "  Remaining manual steps (see docs/launch-checklist.md):"
echo "    - Verify https://api.usetpm.dev/health"
echo "    - Verify npx tpm@latest --help on a fresh machine"
echo "    - Cloudflare Pages: trigger a rebuild for the marketing site"
echo "    - Announce on GitHub releases / email / X"
