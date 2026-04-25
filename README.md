# dbxIntacctAgentTools

A comprehensive Sage Intacct query and agent toolkit for Databricks customers. Provides a typed Python SDK for ingestion pipelines and a Databricks-hosted custom MCP (Model Context Protocol) server for agent and AI Playground integrations.

The tooling is generic: any Databricks customer running ETL or building agents against Sage Intacct can deploy this stack and add their own per-tenant configuration.

## What's in this project

| Component | Purpose |
|---|---|
| `dbxIntacctAgentTools_infra/` | DAB: shared infrastructure (Lakebase, UC schema/volumes, secret scope, SQL warehouse, UC setup job, MLflow3 experiment, registered model). Deploy first. |
| `dbxIntacctAgentTools_sdk/` | Python SDK — auth class with token caching/refresh, OpenAPI-generated REST client, pagination + backoff helpers. Used by Lakeflow Jobs, notebooks, and any Python pipeline. |
| `dbxIntacctAgentTools_mcp/` | DAB: Databricks App scaffolded with [AppKit](https://www.databricks.com/dev-tools/apps). Hosts a custom MCP server (HTTP/SSE transport) named `mcp-intacct`. Discovered automatically by Databricks AI Playground because of the `mcp-` prefix. |
| `deploy.sh` | Orchestrates the two-bundle deploy: validate → infra → bootstrap → readiness checks → app. |

## Architecture

```
Sage Intacct REST API (per-tenant)
    │
    ├──── Python SDK ─── Lakeflow Jobs / Notebooks ── UC Delta tables
    │                                                  (bronze → silver → gold)
    │
    └──── TypeScript client ── Databricks App (mcp-intacct)
                                ├── MCP HTTP/SSE endpoint  ◀── AI Playground
                                ├── Admin UI               ◀── tenant config + audit
                                └── Lakebase OLTP           (call log, tool runs, memory)
```

## Tech stack

- **Bundles**: Databricks Asset Bundles (DABs) v0.296.0+
- **Language (SDK)**: Python 3.11+
- **Language (App)**: TypeScript / Node.js with `@databricks/appkit`
- **Compute**: Serverless SQL warehouse, Lakeflow Jobs, Databricks Apps
- **Storage**: Unity Catalog (analytical) + Lakebase Postgres (OLTP) + UC Volumes (raw responses, MLflow artifacts)
- **Observability**: MLflow 3 experiment for agent traces; OpenTelemetry from the App

## Deployment

```bash
# 1. First-time deploy: infra + bootstrap job (creates SPN, secret scope, tables)
./deploy.sh --target dev --run-setup

# 2. Provision Sage Intacct credentials (one-time admin step) — see infra README
databricks secrets put-secret <scope> intacct_sender_id     --string-value "<sender>"
databricks secrets put-secret <scope> intacct_sender_password --string-value "<pwd>"

# 3. Deploy the MCP app
./deploy.sh --target dev --app
```

## Targets

| Target | Catalog | Mode | Workspace |
|---|---|---|---|
| `dev` | `hls_fde_dev` | development | `fevm-hls-fde.cloud.databricks.com` |
| `hls_fde` | `hls_fde` | production | `fevm-hls-fde.cloud.databricks.com` |
| `prod` | TBD | production | TBD |

## License

See [LICENSE](LICENSE).
