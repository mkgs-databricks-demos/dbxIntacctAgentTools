# dbxIntacctAgentTools_infra

Shared infrastructure DAB for the Intacct Agent toolkit. Deploy this **before** the `dbxIntacctAgentTools_mcp` app bundle.

## Resources

| Resource | File | Notes |
|---|---|---|
| Secret scope | `intacct.secret_scope.yml` | Holds Databricks SPN creds + Sage ISV/per-tenant creds |
| UC schema | `intacct.schema.yml` | Single source-of-truth for catalog + schema |
| Volume — raw | `raw_responses.volume.yml` | Raw Sage API JSON/XML payloads |
| Volume — MLflow | `mlflow_artifacts.volume.yml` | MLflow3 experiment artifacts |
| Lakebase | `intacct.lakebase.yml` | OLTP store: tenants, MCP call log, agent memory |
| SQL warehouse | `infra_warehouse.sql_warehouse.yml` | DDL + analytical queries |
| UC setup job | `uc_setup.job.yml` | Bootstraps SPN + tables + grants |
| MLflow experiment | `intacct_traces.experiment.yml` | Tool-call traces, agent eval runs |
| Registered model | `intacct_query_agent.registered_model.yml` | Placeholder for the routing/summarization agent |

## Deploy

```bash
# Validate
databricks bundle validate --target dev

# Deploy + run setup job
databricks bundle deploy --target dev
databricks bundle run intacct_agent_uc_setup --target dev
```

## Post-deploy admin steps

After the setup job runs, an admin must populate three credential families:

```bash
SCOPE=intacct_credentials   # whatever the bundle resolved to

# 1. Databricks SPN OAuth secret (one-time)
databricks account service-principal-secrets create <sp_id>
databricks secrets put-secret $SCOPE <client_secret_dbs_key> --string-value "<dbs_secret>"

# 2. Sage Intacct ISV credentials (one-time)
databricks secrets put-secret $SCOPE intacct_sender_id     --string-value "<sender>"
databricks secrets put-secret $SCOPE intacct_sender_password --string-value "<pwd>"

# 3. Per-tenant Sage Intacct user credentials (per company)
databricks secrets put-secret $SCOPE intacct_user_<company_id>     --string-value "<ws-user>"
databricks secrets put-secret $SCOPE intacct_password_<company_id> --string-value "<ws-pwd>"
```

## App admin allow-list

The MCP app gates registry mutations (`tenants.upsert`, `tenants.disable`) behind
`INTACCT_MCP_ADMIN_USERS` — a comma-separated list of user emails that the
`x-forwarded-user` header must match (case-insensitive). Set this on the app
resource in `dbxIntacctAgentTools_mcp/resources/intacct_mcp.app.yml` per target,
or as a runtime env override:

```bash
databricks apps update mcp-intacct-dev \
  --custom-env-vars INTACCT_MCP_ADMIN_USERS=alice@databricks.com,bob@databricks.com
```

In `NODE_ENV=development` only, the value `*` opens mutations to every signed-in
user (escape hatch for local work). Production with an empty value puts the app
in read-only mode (every mutation returns `UNAUTHORIZED`).
