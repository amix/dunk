#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist_dir="${repo_root}/dist"
outfile="${dist_dir}/dunk"

mkdir -p "${dist_dir}"

BUN_TMPDIR="${repo_root}/.bun-tmp" \
BUN_INSTALL="${repo_root}/.bun-install" \
bun build --compile "${repo_root}/src/main.tsx" --outfile "${outfile}"

printf 'Built %s\n' "${outfile}"
