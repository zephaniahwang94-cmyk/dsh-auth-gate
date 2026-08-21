#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Options:
  --protection Full|NetworkAuth|ApprovalLimit  Protection preset (default: Full)
  --profile NAME                              Harness profile (default: web)
  --harness-path PATH                         DeepSeek Harness source checkout
  --start                                     Start Harness after installation
  -h, --help                                  Show this help
EOF
}

protection=Full
profile=web
harness_path=
start=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --protection) [ "$#" -ge 2 ] || { echo "Missing value for --protection" >&2; exit 2; }; protection=$2; shift 2 ;;
    --profile) [ "$#" -ge 2 ] || { echo "Missing value for --profile" >&2; exit 2; }; profile=$2; shift 2 ;;
    --harness-path) [ "$#" -ge 2 ] || { echo "Missing value for --harness-path" >&2; exit 2; }; harness_path=$2; shift 2 ;;
    --start) start=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$protection" in
  Full) preset_name=full.yml ;;
  NetworkAuth) preset_name=network-auth.yml ;;
  ApprovalLimit) preset_name=approval-limit.yml ;;
  *) echo "Invalid protection: $protection" >&2; exit 2 ;;
esac

case "$profile" in
  ''|*[!A-Za-z0-9._-]*) echo "Invalid profile name: $profile" >&2; exit 2 ;;
esac

command -v node >/dev/null 2>&1 || { echo "Node.js 22.19+ or 24+ is required." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required." >&2; exit 1; }

plugin_path=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
preset_path=$plugin_path/presets/$preset_name
[ -f "$preset_path" ] || { echo "Missing protection preset: $preset_path" >&2; exit 1; }

if [ "$protection" != ApprovalLimit ]; then
  [ -n "${DSH_AUTH_USERNAME:-}" ] && [ -n "${DSH_AUTH_PASSWORD:-}" ] || {
    echo "Set DSH_AUTH_USERNAME and DSH_AUTH_PASSWORD before installing a network-auth preset." >&2
    echo "Credentials are never written to patch files." >&2
    exit 1
  }
  if [ "${DSH_AUTH_SECURE_COOKIE:-false}" != true ]; then
    echo "Warning: session cookies are not Secure. Set DSH_AUTH_SECURE_COOKIE=true for HTTPS/public deployments." >&2
  fi
fi

if [ -z "$harness_path" ] && ! command -v dsh >/dev/null 2>&1; then
  sibling_harness=$(dirname -- "$plugin_path")/deepseek-harness
  if [ -f "$sibling_harness/package.json" ]; then
    harness_path=$sibling_harness
  fi
fi

run_dsh() {
  if [ -n "$harness_path" ]; then
    [ -f "$harness_path/package.json" ] || { echo "Invalid Harness source path: $harness_path" >&2; return 1; }
    if command -v pnpm >/dev/null 2>&1; then
      (cd -- "$harness_path" && pnpm dsh "$@")
    else
      echo "No global pnpm found; using a temporary pnpm through npx." >&2
      (cd -- "$harness_path" && npx --yes pnpm dsh "$@")
    fi
  elif command -v dsh >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1; then
    dsh "$@"
  else
    echo "Using temporary official dsh and pnpm CLIs through npx." >&2
    npx --yes --package pnpm --package @deepseek-ai/dsh -- dsh "$@"
  fi
}

(
  cd -- "$plugin_path"
  npm ci --ignore-scripts
  npm run build
)

run_dsh plugin --profile "$profile" add "$plugin_path"

echo "Installed dsh-auth-gate with the '$protection' preset."
if [ -n "$harness_path" ]; then
  printf "Launch from %s: pnpm dsh --profile %s --patch '%s'\n" "$harness_path" "$profile" "$preset_path"
elif command -v dsh >/dev/null 2>&1; then
  printf "Launch command: dsh --profile %s --patch '%s'\n" "$profile" "$preset_path"
else
  printf "Launch command: npx @deepseek-ai/dsh --profile %s --patch '%s'\n" "$profile" "$preset_path"
fi

if [ "$protection" = ApprovalLimit ]; then
  echo "Warning: network authentication is disabled; HTTP and WebSocket routes remain unauthenticated." >&2
fi

if [ "$start" = true ]; then
  run_dsh --profile "$profile" --patch "$preset_path"
fi
