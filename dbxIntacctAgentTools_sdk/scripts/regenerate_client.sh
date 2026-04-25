#!/usr/bin/env bash
# Regenerate the Sage Intacct REST client from the published OpenAPI spec.
#
# Requires `openapi-python-client` (installed via the [dev] extra).
#
# Usage:
#   ./scripts/regenerate_client.sh                       # latest spec
#   ./scripts/regenerate_client.sh --spec ./local.yaml   # use a local spec

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GEN_OUT="${SDK_ROOT}/src/intacct_sdk/_generated"
SPEC_DIR="${SDK_ROOT}/spec"
SPEC_URL="https://developer.sage.com/intacct/apis/intacct/1/intacct-openapi.yaml"
SPEC_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --spec) SPEC_FILE="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "${SPEC_DIR}"

if [[ -z "${SPEC_FILE}" ]]; then
  STAMP=$(date +%Y%m%d)
  SPEC_FILE="${SPEC_DIR}/intacct-openapi-${STAMP}.yaml"
  echo "Downloading spec → ${SPEC_FILE}"
  curl -fsSL "${SPEC_URL}" -o "${SPEC_FILE}"
fi

if ! command -v openapi-python-client >/dev/null 2>&1; then
  echo "openapi-python-client not found. Install via:"
  echo "  pip install -e '.[dev]'"
  exit 1
fi

echo "Generating client → ${GEN_OUT}/intacct_openapi/"
rm -rf "${GEN_OUT}/intacct_openapi"
openapi-python-client generate \
  --path "${SPEC_FILE}" \
  --output-path "${GEN_OUT}/intacct_openapi" \
  --overwrite

echo "Done. Generated client at ${GEN_OUT}/intacct_openapi/"
