#!/usr/bin/env bash
set -euo pipefail

bun run check
bun test
bash scripts/test-install-config.sh
bun run build
