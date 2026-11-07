#!/usr/bin/env bash
# Builds @lookout/wasm - Lookout's Rust recorder engine compiled to WebAssembly, which
# @lookout/react records through.
#
# Adds the wasm32 target and the matching wasm-bindgen CLI if they're missing. On CI and Vercel
# (whose build image has no Rust at all) it installs Rust too; locally it asks you to, rather than
# piping an installer into your shell.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
wasm="$root/vendor/lookout/packages/wasm"

if [ ! -f "$wasm/build.sh" ]; then
  echo "build-lookout-wasm: $wasm is missing - run \`git submodule update --init\`" >&2
  exit 1
fi

export PATH="$HOME/.cargo/bin:$PATH"

# rustup, not just cargo: a distro cargo can't add the wasm32 target.
if ! command -v rustup >/dev/null 2>&1; then
  if [ -z "${CI:-}" ] && [ -z "${VERCEL:-}" ]; then
    echo "build-lookout-wasm: Lookout's recorder needs Rust - install it from https://rustup.rs and try again" >&2
    exit 1
  fi

  echo "build-lookout-wasm: installing Rust"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path
fi

rustup target add wasm32-unknown-unknown
bash "$wasm/install-bindgen.sh" "$HOME/.cargo/bin"
bash "$wasm/build.sh"
