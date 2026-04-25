#!/usr/bin/env bash
# deploy.sh — Deployment orchestrator for dbxIntacctAgentTools.
#
# Deploys Databricks Asset Bundles in dependency order:
#   1. dbxIntacctAgentTools_infra (secret scopes, UC schema/volumes,
#                                  SQL warehouse, Lakebase, MLflow,
#                                  registered model)
#   2. UC setup job              (SPN creation, secret provisioning, table DDL)
#   3. Readiness checks          (auto-provisioned secret keys + analytical
#                                 tables + Lakebase status)
#   4. dbxIntacctAgentTools_mcp  (AppKit app: mcp-intacct)
#
# Usage:
#   ./deploy.sh --target dev                          # deploy all (with checks)
#   ./deploy.sh --target dev --run-setup              # deploy infra + run setup + app
#   ./deploy.sh --target dev --infra                  # deploy only infra
#   ./deploy.sh --target dev --infra --run-setup      # deploy infra + run setup
#   ./deploy.sh --target dev --app                    # deploy only the app
#   ./deploy.sh --target dev --app --skip-checks      # deploy app, skip readiness
#   ./deploy.sh --target dev --validate               # validate only
#   ./deploy.sh --target dev --destroy                # destroy deployed resources
#
# Infrastructure Readiness Checks (gate before app bundle deploy):
#   Secret scope keys — all must be present:
#     Auto-provisioned:  {client_id_dbs_key}, workspace_url
#     Admin-provisioned: {client_secret_dbs_key},
#                        intacct_sender_id, intacct_sender_password
#   Analytical tables — mcp_call_log must exist in the target catalog.schema
#   Lakebase project  — informational; reports status (optional, not blocking)
#
# Requirements:
#   - Databricks CLI installed and authenticated (databricks auth login)
#   - python3 (for JSON parsing of CLI output)

set -euo pipefail

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_BUNDLE="dbxIntacctAgentTools_infra"
APP_BUNDLE="dbxIntacctAgentTools_mcp"

# Resolved at runtime by build_key_arrays() after resolve_infra_vars()
REQUIRED_SCOPE_KEYS=()
AUTO_PROVISIONED_KEYS=()
ADMIN_PROVISIONED_KEYS=()
CHECK_TABLE="mcp_call_log"
UC_SETUP_JOB="intacct_agent_uc_setup"

# Resolved at runtime by resolve_infra_vars()
SCOPE_NAME=""
CATALOG=""
SCHEMA=""
CLIENT_ID_DBS_KEY=""
CLIENT_SECRET_DBS_KEY=""
LAKEBASE_PROJECT_ID=""
WORKSPACE_HOST=""

# --------------------------------------------------------------------------- #
# Defaults
# --------------------------------------------------------------------------- #
TARGET=""
DEPLOY_INFRA=true
DEPLOY_APP=true
VALIDATE_ONLY=false
DESTROY=false
RUN_SETUP=false
SKIP_CHECKS=false

# --------------------------------------------------------------------------- #
# Usage
# --------------------------------------------------------------------------- #
usage() {
  cat <<EOF
Usage: $(basename "$0") --target <target> [OPTIONS]

Options:
  --target <name>    Required. Bundle target (dev, hls_fde, prod).
  --infra            Deploy only the infrastructure bundle.
  --app              Deploy only the application bundle (skip infra).
  --run-setup        Run the UC setup job after deploying the infra bundle.
  --skip-checks      Skip infrastructure readiness checks before app deploy.
  --validate         Validate bundles without deploying.
  --destroy          Destroy deployed resources for the target.
  -h, --help         Show this help message.

Deployment order:
  1. ${INFRA_BUNDLE}
  2. UC setup job  (SPN creation, secret provisioning, table DDL)
  3. Readiness checks
  4. ${APP_BUNDLE}  (AppKit app: mcp-intacct)

First-time deploy:
  ./deploy.sh --target dev --run-setup
  # Then: admin provisions client_secret + Sage Intacct credentials
  ./deploy.sh --target dev --app
EOF
  exit 0
}

# --------------------------------------------------------------------------- #
# Parse arguments
# --------------------------------------------------------------------------- #
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)       TARGET="$2"; shift 2 ;;
    --infra)        DEPLOY_INFRA=true;  DEPLOY_APP=false; shift ;;
    --app)          DEPLOY_INFRA=false; DEPLOY_APP=true;  shift ;;
    --run-setup)    RUN_SETUP=true; shift ;;
    --skip-checks)  SKIP_CHECKS=true; shift ;;
    --validate)     VALIDATE_ONLY=true; shift ;;
    --destroy)      DESTROY=true; shift ;;
    -h|--help)      usage ;;
    *)              echo "Error: Unknown option '$1'"; usage ;;
  esac
done

if [[ -z "${TARGET}" ]]; then
  echo "Error: --target is required."
  usage
fi

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
log()  { echo -e "\n\033[1;34m==>\033[0m \033[1m$1\033[0m"; }
warn() { echo -e "\033[1;33m  ⚠  $1\033[0m"; }
ok()   { echo -e "\033[1;32m  ✓  $1\033[0m"; }
fail() { echo -e "\033[1;31m  ✗  $1\033[0m"; exit 1; }

# --------------------------------------------------------------------------- #
# Prerequisites
# --------------------------------------------------------------------------- #
command -v databricks &>/dev/null || fail "Databricks CLI not found. Install: https://docs.databricks.com/dev-tools/cli/install.html"
command -v python3    &>/dev/null || fail "python3 not found (required for JSON parsing)."

# --------------------------------------------------------------------------- #
# deploy_bundle — validate and deploy (or destroy) a single bundle
# --------------------------------------------------------------------------- #
deploy_bundle() {
  local bundle_name="$1"
  local bundle_dir="${SCRIPT_DIR}/${bundle_name}"

  if [[ ! -d "${bundle_dir}" ]]; then
    warn "Bundle directory '${bundle_name}' does not exist yet — skipping."
    return 0
  fi

  if [[ ! -f "${bundle_dir}/databricks.yml" ]]; then
    warn "No databricks.yml found in '${bundle_name}' — skipping."
    return 0
  fi

  log "Validating ${bundle_name} (target: ${TARGET})"
  (cd "${bundle_dir}" && databricks bundle validate --target "${TARGET}")
  ok "Validation passed: ${bundle_name}"

  if [[ "${VALIDATE_ONLY}" == true ]]; then
    return 0
  fi

  if [[ "${DESTROY}" == true ]]; then
    log "Destroying ${bundle_name} (target: ${TARGET})"
    (cd "${bundle_dir}" && databricks bundle destroy --target "${TARGET}" --auto-approve)
    ok "Destroyed: ${bundle_name}"
  else
    log "Deploying ${bundle_name} (target: ${TARGET})"
    (cd "${bundle_dir}" && databricks bundle deploy --target "${TARGET}")
    ok "Deployed: ${bundle_name}"
  fi
}

# --------------------------------------------------------------------------- #
# resolve_infra_vars — extract scope name, catalog, schema, secret key names,
#                      and Lakebase project ID from the infra bundle summary
# --------------------------------------------------------------------------- #
resolve_infra_vars() {
  local bundle_dir="${SCRIPT_DIR}/${INFRA_BUNDLE}"

  log "Resolving infrastructure variables (target: ${TARGET})"

  local summary_json
  summary_json=$(cd "${bundle_dir}" && databricks bundle summary --target "${TARGET}" --output json) || {
    fail "Could not read bundle summary for ${INFRA_BUNDLE}.\n" \
         "  Deploy the infra bundle first:\n" \
         "    cd ${bundle_dir} && databricks bundle deploy --target ${TARGET}"
  }

  eval "$(echo "${summary_json}" | python3 -c "
import sys, json, re

try:
    data = json.load(sys.stdin)
except json.JSONDecodeError as e:
    print(f'RESOLVE_ERROR=\"JSON parse error: {e}\"', flush=True)
    sys.exit(0)

vars_block = data.get('variables', {})

def get_var(name, default=''):
    v = vars_block.get(name, {})
    if isinstance(v, dict):
        return v.get('value', default)
    return str(v) if v else default

scope = get_var('secret_scope_name')
client_id_key    = get_var('client_id_dbs_key', 'client_id')
client_secret_key = get_var('client_secret_dbs_key', 'client_secret')

catalog = ''
schema  = ''
resources = data.get('resources', {})
schemas_block = resources.get('schemas', {})
for schema_name, ws in schemas_block.items():
    if isinstance(ws, dict):
        catalog = ws.get('catalog_name', '')
        schema  = ws.get('name', '')

if not catalog:
    catalog = get_var('catalog')
if not schema:
    schema = get_var('schema')

project_id = get_var('lakebase_project_id')
if not project_id:
    pg_projects = resources.get('postgres_projects', {})
    for proj_name, proj in pg_projects.items():
        if isinstance(proj, dict):
            project_id = proj.get('project_id', '')
            if project_id:
                break

workspace_host = data.get('workspace', {}).get('host', '')

def safe(v):
    return re.sub(r'[^a-zA-Z0-9_.\-]', '', str(v))

def safe_url(v):
    return re.sub(r'[^a-zA-Z0-9_./:\-]', '', str(v))

print(f'SCOPE_NAME=\"{safe(scope)}\"')
print(f'CATALOG=\"{safe(catalog)}\"')
print(f'SCHEMA=\"{safe(schema)}\"')
print(f'CLIENT_ID_DBS_KEY=\"{safe(client_id_key)}\"')
print(f'CLIENT_SECRET_DBS_KEY=\"{safe(client_secret_key)}\"')
print(f'LAKEBASE_PROJECT_ID=\"{safe(project_id)}\"')
print(f'WORKSPACE_HOST=\"{safe_url(workspace_host)}\"')
" 2>/dev/null)" || fail "Could not parse bundle summary JSON."

  if [[ -n "${RESOLVE_ERROR:-}" ]]; then
    fail "Bundle summary parse error: ${RESOLVE_ERROR}"
  fi

  [[ -n "${SCOPE_NAME}" ]]            || fail "Could not resolve secret_scope_name from bundle summary."
  [[ -n "${CATALOG}" ]]               || fail "Could not resolve catalog from bundle summary."
  [[ -n "${SCHEMA}" ]]                || fail "Could not resolve schema from bundle summary."
  [[ -n "${CLIENT_ID_DBS_KEY}" ]]     || fail "Could not resolve client_id_dbs_key from bundle summary."
  [[ -n "${CLIENT_SECRET_DBS_KEY}" ]] || fail "Could not resolve client_secret_dbs_key from bundle summary."
  [[ -n "${WORKSPACE_HOST}" ]]        || fail "Could not resolve workspace.host from bundle summary."

  ok "Secret scope:        ${SCOPE_NAME}"
  ok "Catalog:             ${CATALOG}"
  ok "Schema:              ${SCHEMA}"
  ok "Client ID key:       ${CLIENT_ID_DBS_KEY}"
  ok "Client secret key:   ${CLIENT_SECRET_DBS_KEY}"
  ok "Workspace host:      ${WORKSPACE_HOST}"

  if [[ -n "${LAKEBASE_PROJECT_ID}" ]]; then
    ok "Lakebase project:    ${LAKEBASE_PROJECT_ID}"
  else
    warn "No Lakebase project found in bundle resources (may not be deployed yet)."
  fi

  build_key_arrays
}

# --------------------------------------------------------------------------- #
# build_key_arrays — populate REQUIRED / AUTO / ADMIN key arrays
# --------------------------------------------------------------------------- #
build_key_arrays() {
  AUTO_PROVISIONED_KEYS=("${CLIENT_ID_DBS_KEY}" "workspace_url")
  ADMIN_PROVISIONED_KEYS=(
    "${CLIENT_SECRET_DBS_KEY}"
    "intacct_sender_id"
    "intacct_sender_password"
  )
  REQUIRED_SCOPE_KEYS=("${AUTO_PROVISIONED_KEYS[@]}" "${ADMIN_PROVISIONED_KEYS[@]}")
}

# --------------------------------------------------------------------------- #
# run_uc_setup — run the UC setup job via the bundle CLI
# --------------------------------------------------------------------------- #
run_uc_setup() {
  local bundle_dir="${SCRIPT_DIR}/${INFRA_BUNDLE}"

  log "Running UC setup job: ${UC_SETUP_JOB} (target: ${TARGET})"
  (cd "${bundle_dir}" && databricks bundle run "${UC_SETUP_JOB}" --target "${TARGET}") || \
    fail "UC setup job failed. Check the Databricks Jobs UI for details."
  ok "UC setup job completed successfully"
}

# --------------------------------------------------------------------------- #
# check_lakebase_status — informational check for Lakebase project health
# --------------------------------------------------------------------------- #
check_lakebase_status() {
  local project_id="${LAKEBASE_PROJECT_ID:-}"
  if [[ -z "${project_id}" ]]; then
    return 0
  fi

  log "Checking Lakebase project status (project: ${project_id})"

  local project_json
  project_json=$(databricks postgres get-project "projects/${project_id}" --output json) || {
    warn "Lakebase project '${project_id}' not found or not accessible."
    warn "If the project was just created, it may still be initializing."
    return 0
  }
  ok "Lakebase project exists: ${project_id}"

  local endpoints_json
  endpoints_json=$(databricks postgres list-endpoints "projects/${project_id}/branches/production" --output json) || {
    warn "Could not list endpoints for project '${project_id}' branch 'production'."
    warn "The branch or endpoint may still be initializing."
    return 0
  }

  ok "Lakebase compute endpoint is running"
  echo "  Note: AppKit's lakebase plugin connects via direct Postgres wire protocol."
}

# --------------------------------------------------------------------------- #
# verify_infra_readiness — gate check before app bundle deployment
# --------------------------------------------------------------------------- #
verify_infra_readiness() {
  log "Verifying infrastructure readiness"

  local secrets_json
  secrets_json=$(databricks secrets list-secrets "${SCOPE_NAME}" --output json) || {
    echo ""
    echo "  Secret scope '${SCOPE_NAME}' not found or not accessible."
    echo "  The UC setup job must run first to create the SPN and populate secrets:"
    echo ""
    echo "    databricks bundle run ${UC_SETUP_JOB} --target ${TARGET}"
    echo "    # or: ./deploy.sh --target ${TARGET} --run-setup"
    echo ""
    fail "Secret scope '${SCOPE_NAME}' does not exist."
  }

  local present_keys
  present_keys=$(echo "${secrets_json}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
secrets = data.get('secrets', data) if isinstance(data, dict) else data
for s in secrets:
    if isinstance(s, dict):
        print(s.get('key', ''))
" 2>/dev/null) || fail "Could not parse secrets list from scope '${SCOPE_NAME}'."

  local missing_auto=()
  local missing_admin=()

  for key in "${REQUIRED_SCOPE_KEYS[@]}"; do
    if echo "${present_keys}" | grep -qx "${key}"; then
      ok "Secret key present: ${key}"
    else
      local is_admin=false
      for admin_key in "${ADMIN_PROVISIONED_KEYS[@]}"; do
        [[ "${key}" == "${admin_key}" ]] && is_admin=true
      done

      if [[ "${is_admin}" == true ]]; then
        missing_admin+=("${key}")
      else
        missing_auto+=("${key}")
      fi
      warn "Secret key MISSING: ${key}"
    fi
  done

  local full_table="${CATALOG}.${SCHEMA}.${CHECK_TABLE}"
  local table_missing=false

  if databricks tables get "${full_table}" &>/dev/null; then
    ok "Table exists: ${full_table}"
  else
    warn "Table MISSING: ${full_table}"
    table_missing=true
  fi

  check_lakebase_status

  if [[ ${#missing_auto[@]} -gt 0 ]] || [[ "${table_missing}" == true ]]; then
    echo ""
    echo "  ============================================================="
    echo "  Auto-provisioned resources are missing."
    echo "  The UC setup job must be run before deploying the app bundle."
    echo "  ============================================================="
    echo ""
    [[ ${#missing_auto[@]} -gt 0 ]] && echo "  Missing secret keys: ${missing_auto[*]}"
    [[ "${table_missing}" == true ]] && echo "  Missing table:       ${full_table}"
    echo ""
    echo "  Run the UC setup job:"
    echo "    databricks bundle run ${UC_SETUP_JOB} --target ${TARGET}"
    echo "    # or: ./deploy.sh --target ${TARGET} --run-setup"
    echo ""
    fail "Infrastructure readiness check failed (auto-provisioned resources missing)."
  fi

  if [[ ${#missing_admin[@]} -gt 0 ]]; then
    echo ""
    echo "  ============================================================="
    echo "  ACTION REQUIRED: Admin must provision the missing credentials."
    echo "  ============================================================="
    echo ""
    echo "  Missing keys: ${missing_admin[*]}"
    echo ""
    echo "  Provisioning steps:"
    echo ""
    echo "  1. Databricks SPN OAuth secret (under ${CLIENT_SECRET_DBS_KEY}):"
    echo "     databricks account service-principal-secrets create <sp_id>"
    echo "     databricks secrets put-secret ${SCOPE_NAME} ${CLIENT_SECRET_DBS_KEY} \\"
    echo '       --string-value "<dbs_secret>"'
    echo ""
    echo "  2. Sage Intacct ISV credentials:"
    echo "     databricks secrets put-secret ${SCOPE_NAME} intacct_sender_id     --string-value '<sender>'"
    echo "     databricks secrets put-secret ${SCOPE_NAME} intacct_sender_password --string-value '<pwd>'"
    echo ""
    echo "  3. Per-tenant Sage Intacct credentials (one user per company):"
    echo "     databricks secrets put-secret ${SCOPE_NAME} intacct_user_<company_id>     --string-value '<ws-user>'"
    echo "     databricks secrets put-secret ${SCOPE_NAME} intacct_password_<company_id> --string-value '<ws-pwd>'"
    echo ""
    echo "  Use --skip-checks to deploy the app bundle without these keys."
    echo ""
    fail "Infrastructure readiness check failed (admin-provisioned secrets missing)."
  fi

  echo ""
  ok "All infrastructure readiness checks passed"
}

# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
log "dbxIntacctAgentTools — Bundle Deployment"
echo "  Target:        ${TARGET}"
echo "  Infra bundle:  ${DEPLOY_INFRA}"
echo "  App bundle:    ${DEPLOY_APP}"
echo "  Run setup:     ${RUN_SETUP}"
echo "  Skip checks:   ${SKIP_CHECKS}"
echo "  Validate only: ${VALIDATE_ONLY}"
echo "  Destroy:       ${DESTROY}"

# Step 1: Deploy infra bundle
if [[ "${DEPLOY_INFRA}" == true ]]; then
  deploy_bundle "${INFRA_BUNDLE}"
fi

# Step 2: Run UC setup job (optional — creates SPN, stores secrets, creates tables)
if [[ "${RUN_SETUP}" == true ]] && [[ "${VALIDATE_ONLY}" != true ]] && [[ "${DESTROY}" != true ]]; then
  run_uc_setup
fi

# Step 3: Verify infrastructure readiness (gate before app bundle deploy)
if [[ "${DEPLOY_APP}" == true ]] && [[ "${SKIP_CHECKS}" != true ]] && [[ "${VALIDATE_ONLY}" != true ]] && [[ "${DESTROY}" != true ]]; then
  resolve_infra_vars
  verify_infra_readiness
fi

# Step 4: Deploy app bundle
if [[ "${DEPLOY_APP}" == true ]]; then
  deploy_bundle "${APP_BUNDLE}"
fi

log "Done."
