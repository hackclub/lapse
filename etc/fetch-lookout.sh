#!/usr/bin/env bash
# Fetches vendor/lookout at the commit Lapse pins, for builds that don't check out submodules (Vercel).
# Keep LOOKOUT_REF in step with the vendor/lookout submodule and client.Dockerfile.
set -euo pipefail

LOOKOUT_REF=385480c3b8d91579191385488c1aecaaa73aace8

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/vendor/lookout"

rm -rf "$dest"
git init -q "$dest"
git -C "$dest" fetch -q --depth 1 https://github.com/hackclub/lookout.git "$LOOKOUT_REF"
git -C "$dest" checkout -q FETCH_HEAD
