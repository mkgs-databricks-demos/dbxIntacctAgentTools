# dbxIntacctAgentTools_mcp

Application bundle for the **mcp-intacct** Databricks App — a custom MCP (Model Context Protocol) server for Sage Intacct, scaffolded with [AppKit](https://www.databricks.com/dev-tools/apps).

The `mcp-` prefix on the app name is **required** so that the app is auto-discovered as a custom MCP tool in Databricks AI Playground.

## Layout

```
dbxIntacctAgentTools_mcp/
├── README.md
├── databricks.yml                # Wrapping DAB (this file's parent owns it)
├── resources/
│   └── intacct_mcp.app.yml       # Databricks App resource (binds secrets, postgres, warehouse, volume)
└── mcp-intacct/                  # AppKit-scaffolded app (databricks apps init --name mcp-intacct)
    ├── app.yaml                  # Runtime env (valueFrom directives)
    ├── appkit.plugins.json       # AppKit plugins: analytics, files, lakebase, server
    ├── package.json              # @databricks/appkit + @modelcontextprotocol/sdk
    ├── server/
    │   ├── server.ts             # AppKit entry — mounts plugins + MCP server
    │   └── mcp/
    │       ├── server.ts         # /mcp HTTP+SSE endpoint
    │       └── tools/            # Curated MCP tool set
    │           ├── index.ts
    │           ├── general_ledger.ts
    │           └── accounts_receivable.ts
    ├── client/                   # Default AppKit React UI (admin/HITL — customize as needed)
    └── tests/smoke.spec.ts       # Playwright smoke test (selectors updated for plugin list)
```

## Prerequisites

1. `dbxIntacctAgentTools_infra` is deployed for the same target.
2. Admin has populated the secret scope with:
   - `client_id_<dbs_key>` (auto by setup job), `workspace_url` (auto)
   - `client_secret_<dbs_key>` (admin-provisioned)
   - `intacct_sender_id`, `intacct_sender_password` (admin-provisioned)
   - per-tenant: `intacct_user_<company_id>`, `intacct_password_<company_id>`
3. Resolve infra-output values into `databricks.yml`:
   - `warehouse_id` ← `databricks bundle summary --target dev` from the infra bundle
   - `postgres_branch`, `postgres_database` ← `databricks postgres list-branches/-databases`
4. `npm install` in `mcp-intacct/`

## Build & deploy

```bash
cd mcp-intacct
npm install                     # adds @modelcontextprotocol/sdk
npm run build                   # appkit sync + typegen + tsdown + vite

cd ..
databricks bundle validate --target dev
databricks bundle deploy   --target dev
```

The orchestrating `deploy.sh` at the project root handles validate → infra readiness checks → app deploy.

## MCP tool surface

| Domain | Tool | Status |
|---|---|---|
| GL | `list_gl_accounts` | Wired to `IntacctClient.listGlAccounts` |
| GL | `get_journal_entry` | Wired to `IntacctClient.getJournalEntry` |
| GL | `query_gl_details` | Wired to `IntacctClient.queryGlDetails` |
| AR | `list_customers` | Wired to `IntacctClient.listCustomers` |
| AR | `list_open_invoices` | Wired to `IntacctClient.listOpenInvoices` |
| AR | `get_customer_balance` | Wired to `IntacctClient.getCustomerBalance` |
| AP | `list_vendors` | Wired to `IntacctClient.listVendors` |
| AP | `list_bills` | Wired to `IntacctClient.listBills` |
| Cash | `list_payments` | Wired to `IntacctClient.listPayments` |
| Cash | `get_cash_position` | Wired to `IntacctClient.getCashPosition` |
| Writes | `post_journal_entry` | Wired to `IntacctClient.postJournalEntry`. **Gated by `writes_enabled`.** |
| Writes | `record_adjustment` | Wired to `IntacctClient.recordAdjustment`. **Gated by `writes_enabled`.** |
| Writes | `apply_payment` | Wired to `IntacctClient.applyPayment`. **Gated by `writes_enabled`.** |

All thirteen tools resolve per-tenant credentials via the registry, persist a row to `mcp_call_log`, and capture raw Sage responses to the `raw_responses` UC Volume. Write tools additionally call `registry.requireWritable()` before invoking Sage and accept an optional `idempotency_key` argument that's forwarded as the `Idempotency-Key` HTTP header. Return values are typed as `Record<string, unknown>` until [§1.1](../NEXT_STEPS.md) lands typed signatures.

Tool stubs accept the proper `inputSchema` shape and return placeholder text. Wire each one to the TypeScript Sage Intacct client (`server/intacct/`) — generated from the OpenAPI spec — to ship a working tool.

## Development

```bash
# in mcp-intacct/
npm run dev       # AppKit dev server with hot reload
npm run typecheck
npm run lint
npm run test      # vitest + playwright smoke
```

## Discovery in AI Playground

Once deployed, the app appears in **AI Playground → MCP Servers → Custom** because of the `mcp-` prefix. Tools register via the SSE endpoint at `https://<app-host>/mcp/sse`.
