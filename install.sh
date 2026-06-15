#!/bin/bash
# Install drop — file sharing via time-limited preview URLs
# Usage: curl -fsSL https://raw.githubusercontent.com/junping1/drop/master/install.sh | bash

set -euo pipefail

# Repo to install from: explicit DROP_REPO wins, then GITHUB_REPOSITORY (set in
# CI / on forks), then the upstream default.
REPO="${DROP_REPO:-${GITHUB_REPOSITORY:-junping1/drop}}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  linux)  OS="linux" ;;
  darwin) OS="darwin" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

TARGET="${OS}-${ARCH}"
BINARY="drop-${TARGET}"

# Get latest release URL
echo "Fetching latest release..."
DOWNLOAD_URL="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep "browser_download_url.*${BINARY}" \
  | cut -d '"' -f 4)"

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: no binary found for ${TARGET}"
  echo "Available at: https://github.com/${REPO}/releases"
  exit 1
fi

# Download and install
mkdir -p "$INSTALL_DIR"
echo "Downloading ${BINARY}..."
curl -fsSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/drop"
chmod +x "${INSTALL_DIR}/drop"
ln -sf "${INSTALL_DIR}/drop" "${INSTALL_DIR}/drop-preview"

echo ""
echo "Installed drop to ${INSTALL_DIR}/drop"
echo "Installed drop-preview alias to ${INSTALL_DIR}/drop-preview"

# Check if in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "Add to your PATH:"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi

echo ""
echo "Get started:"
echo "  drop ~/file.py              # share a file"
echo "  drop-preview ~/file.py      # same command, clearer for AI agents"
echo "  drop ~/project/             # share a directory"
echo "  drop list                   # list active shares"
