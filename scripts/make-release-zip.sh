#!/usr/bin/env bash
# Builds dist/shareloc-demo-<date>.zip from the tracked files of the current branch.
# Secrets (shareloc.properties, .env, local.properties) are git-ignored and therefore never included.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
name="shareloc-demo-$(date +%Y%m%d)"
git archive --format=zip --prefix="$name/" -o "dist/$name.zip" HEAD
echo "Wrote dist/$name.zip ($(du -h "dist/$name.zip" | cut -f1))"
