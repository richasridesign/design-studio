#!/bin/sh
# Builds canvas-core. Homebrew's rustup keeps cargo off PATH, so the usual rustup folders are tried too.
set -e
cd "$(dirname "$0")"
PATH="$PATH:$HOME/.cargo/bin:/opt/homebrew/opt/rustup/bin:/usr/local/opt/rustup/bin"
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust is not installed. Install it from rustup.rs, then run npm run core." >&2
  exit 1
fi
cargo build --release --quiet
