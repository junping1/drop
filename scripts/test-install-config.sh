#!/bin/bash
set -euo pipefail

source_line="$(grep '^REPO=' install.sh)"
alias_line="$(grep 'ln -sf .*drop-preview' install.sh)"

# Falls back to the upstream default when neither var is set.
eval "unset DROP_REPO GITHUB_REPOSITORY; ${source_line}"
test "$REPO" = "junping1/drop"

# DROP_REPO takes precedence over GITHUB_REPOSITORY.
eval "DROP_REPO=owner/drop; GITHUB_REPOSITORY=other/repo; ${source_line}"
test "$REPO" = "owner/drop"

# GITHUB_REPOSITORY is used as a fallback when DROP_REPO is unset (CI / forks).
eval "unset DROP_REPO; GITHUB_REPOSITORY=some-org/some-app; ${source_line}"
test "$REPO" = "some-org/some-app"

test -n "$alias_line"

echo "install-config checks passed"
