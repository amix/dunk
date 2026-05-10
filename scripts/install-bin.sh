#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_dir="${DUNK_INSTALL_DIR:-${HOME}/.local/bin}"
install_path="${install_dir}/dunk"
entrypoint="${repo_root}/src/main.tsx"

if ! command -v bun >/dev/null 2>&1; then
  printf 'bun is required on PATH for the local install. Install bun first.\n' >&2
  exit 1
fi

mkdir -p "${install_dir}"

# Self-contained binary install (`bun build --compile`) costs ~0.6s of self-extract on every
# launch. Local installs use a tiny shell wrapper that invokes bun against the source — about
# 6× faster startup at the cost of needing bun on PATH at runtime. For a portable single-binary
# build, run scripts/build-bin.sh directly.
cat >"${install_path}" <<EOF
#!/usr/bin/env bash
exec bun run "${entrypoint}" -- "\$@"
EOF
chmod 0755 "${install_path}"

printf 'Installed %s\n' "${install_path}"

case ":${PATH}:" in
  *":${install_dir}:"*) ;;
  *)
    printf 'Warning: %s is not on PATH\n' "${install_dir}" >&2
    ;;
esac
