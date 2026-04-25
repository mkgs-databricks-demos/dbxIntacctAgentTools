#!/usr/bin/env bash
# Regenerate the Sage Intacct REST TypeScript types from the published
# OpenAPI spec. Output is a single types-only file at
#   server/intacct/_generated/intacct-openapi.ts
#
# We use openapi-typescript (types-only) rather than a full client
# generator because:
#   - The hand-written wrapper in server/intacct/client.ts handles auth,
#     pagination, retries, and per-tenant credential routing.
#   - Types-only output is one file with zero runtime dependencies.
#
# Usage:
#   ./scripts/regenerate_intacct_client.sh                     # latest spec
#   ./scripts/regenerate_intacct_client.sh --spec ./local.yaml # use local spec

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GEN_OUT="${APP_ROOT}/server/intacct/_generated"
SPEC_DIR="${APP_ROOT}/spec"
SPEC_URL="https://developer.sage.com/intacct/apis/intacct/1/intacct-openapi.yaml"
SPEC_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --spec) SPEC_FILE="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "${SPEC_DIR}" "${GEN_OUT}"

if [[ -z "${SPEC_FILE}" ]]; then
  STAMP=$(date +%Y%m%d)
  SPEC_FILE="${SPEC_DIR}/intacct-openapi-${STAMP}.yaml"
  echo "Downloading spec → ${SPEC_FILE}"
  curl -fsSL "${SPEC_URL}" -o "${SPEC_FILE}"
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found. Run 'npm install' inside mcp-intacct/ first." >&2
  exit 1
fi

OUT_FILE="${GEN_OUT}/intacct-openapi.ts"
echo "Generating types → ${OUT_FILE}"
npx --yes openapi-typescript "${SPEC_FILE}" -o "${OUT_FILE}"

echo "Done. Types at ${OUT_FILE}"
