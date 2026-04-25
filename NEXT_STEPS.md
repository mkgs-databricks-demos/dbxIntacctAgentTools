# Next Steps

A running list of open work for `dbxIntacctAgentTools`. Updated as PRs land. Items grouped by theme; each item has motivation, rough effort, and any prerequisites called out.

## Status snapshot

What works today (merged through PR #6):

- ✅ Two-bundle DAB layout (`_infra` + `_mcp`), orchestrated by `deploy.sh`
- ✅ Python SDK with token-cached auth + pagination + backoff (used by Lakeflow Jobs)
- ✅ TypeScript Sage Intacct client (server-side, mirrors the Python SDK)
- ✅ AppKit-scaffolded MCP server (`mcp-intacct`) with HTTP/SSE transports
- ✅ Six MCP tools wired to the typed client (3 GL + 3 AR), all stubbed for the Sage REST surface
- ✅ Lakebase tenant registry + persistent MCP call log
- ✅ Admin React UI (tRPC) for tenant CRUD + recent-call audit

What's missing before this is a real production tool — the rest of this doc.

---

## 1. Sage Intacct integration depth

### 1.1 Use OpenAPI-generated types in `IntacctClient`
**What:** the TS client methods currently return `Record<string, unknown>`. After running `./scripts/regenerate_intacct_client.sh` (which lands typed schemas under `server/intacct/_generated/intacct-openapi.ts`), thread those types through `client.listGlAccounts`, `client.getJournalEntry`, etc.
**Why:** removes an entire class of "field doesn't exist" errors from MCP tool code and gives downstream agents richer schemas in the MCP `outputSchema`.
**Effort:** small — one PR.
**Prereq:** access to the published OpenAPI spec (network).

### 1.2 Build out the AP / Cash MCP tools
**What:** add `list_vendors`, `list_bills`, `list_payments`, `get_cash_position` to `server/mcp/tools/`. Mirror the GL / AR shape: zod input schemas, `runTenantCall`, persisted to `mcp_call_log`.
**Why:** the current 6-tool surface is read-heavy and GL/AR-only; AP and Cash are the other two domains operators ask for.
**Effort:** small.

### 1.3 Add write-path MCP tools
**What:** `post_journal_entry`, `record_adjustment`, `apply_payment` — guarded by an explicit allow-list on the tenant registry (`writes_enabled` flag), and by tRPC-level auth (see §3.1).
**Why:** unlocks the CAAS Phase 2 use case (extract → land in Sage). Big value, but biggest blast radius if it goes wrong.
**Effort:** medium — needs idempotency keys and rollback semantics.
**Prereq:** §3.1 auth.

### 1.4 Consume the official Sage Intacct MCP server
**What:** Sage shipped their own MCP at `developer.sage.com/intacct/mcps/intacct-mcp/...` in Nov 2025. Evaluate whether this server should call it (as a Databricks-side façade), and which procedures we'd thin out.
**Why:** less code to maintain if Sage's surface covers what we need; Sage Copilot ecosystem alignment.
**Effort:** medium — research first, then decide build vs. delegate.

---

## 2. Observability

### 2.1 Raw-response capture to the `raw_responses` UC Volume
**What:** in `IntacctClient.request()`, the `onRawResponse` hook is wired but unused. Implement a hook that writes JSON payloads to `/Volumes/<catalog>/<schema>/raw_responses/<tenant_id>/<date>/<request_id>.json` via the AppKit `files` plugin, and records a pointer row in the UC `raw_response_index` Delta table.
**Why:** debugging Sage REST schema drift without re-running calls; audit evidence for regulated customers.
**Effort:** small — wire two existing primitives.

### 2.2 Stream `mcp_call_log` from Lakebase → UC Delta
**What:** Lakeflow Job that reads from Lakebase OLTP and writes to the UC Delta `mcp_call_log` table created in `target-tables-ddl.sql`.
**Why:** the Lakebase table is for hot-path admin reads; analytical queries (top tools, p95 latency, error rates by tenant) belong on Delta.
**Effort:** medium — needs incremental loading via `created_at` watermark.

### 2.3 Verify OTel telemetry export
**What:** the `intacct_mcp.app.yml` declares `telemetry_export_destinations` for `app_otel_logs`/`_traces`/`_metrics`. After first deploy, confirm the three Delta tables get populated and add a default Lakeview dashboard.
**Why:** built-in OTel is free; just need to confirm it works and surface it.
**Effort:** small.
**Prereq:** infra deployed.

### 2.4 Pagination + filtering on the Recent Calls UI
**What:** `RecentCalls.tsx` shows the last 25 only. Add filter inputs (tenant, tool name, status) and offset-based pagination using existing `mcpCallLog.recent` filters.
**Why:** at any real volume, last-25 is too small.
**Effort:** small.

---

## 3. Auth / security hardening

### 3.1 OBO auth on tRPC procedures
**What:** today every tRPC procedure is `publicProcedure`. Use `getUserContext()` from AppKit + a workspace-admin allow-list to gate `tenants.upsert` / `tenants.disable` / future write-path MCP tools.
**Why:** the registry currently lets any app user mutate any tenant. Should require explicit admin permission.
**Effort:** medium.
**Prereq:** none — AppKit ships OBO.

### 3.2 Validate the Sage Intacct REST auth flow against a real sandbox
**What:** `IntacctAuth` was written from documentation, not a live exchange. The exact body keys (`grant_type`, `sender_id`, etc.) and endpoint URL need a smoke test against a Sage sandbox.
**Why:** we'll find out exactly what the auth endpoint expects only by hitting it.
**Effort:** small (just runtime verification).
**Prereq:** Sage sandbox + credentials.

### 3.3 Tenant write allow-list flag
**What:** add `writes_enabled` boolean to `tenant_registry`; admin UI toggles it; write-path MCP tools (§1.3) reject if false.
**Why:** safer default — read-only unless explicitly enabled per tenant.
**Effort:** small (schema migration + check).

---

## 4. Operations / deploy hygiene

### 4.1 Resolve infra-output placeholders in `_mcp` `databricks.yml`
**What:** the per-target `warehouse_id`, `postgres_branch`, `postgres_database` start as `REPLACE_WITH_INFRA_WAREHOUSE_ID` / template strings. After first `./deploy.sh --target dev --infra --run-setup`, run `databricks bundle summary --target dev` against the infra bundle and copy the resolved values into `dbxIntacctAgentTools_mcp/databricks.yml`.
**Why:** deploy will fail without these.
**Effort:** trivial (per target).
**Prereq:** infra deployed.

### 4.2 Provision admin secrets
**What:** after the UC setup job runs, an admin must populate `client_secret_<dbs_key>`, `intacct_sender_id`, `intacct_sender_password`, and per-tenant `intacct_user_<id>` / `intacct_password_<id>`. Documented in `dbxIntacctAgentTools_infra/README.md`.
**Why:** the app SPN can't talk to Databricks (or Sage) without these.
**Effort:** trivial (one-time per env, plus per-tenant onboarding).

### 4.3 Move `deploy.sh --target dev --run-setup` to CI
**What:** add a GitHub Action that runs validate-only on every PR (`databricks bundle validate` for both bundles + `npm run typecheck && npm run lint && npx vitest run`).
**Why:** the existing CodeQL checks catch security issues but not bundle drift or test regressions.
**Effort:** small.

---

## 5. Tracking items / known issues

### 5.1 `uuid@9` Dependabot alert
The `GHSA-w5hq-g745-h8pq` advisory says "fixed in 14.0.0", but uuid 14.0.0 isn't published to npm yet (latest is 13.0.0). The vulnerability is also unreachable in our chain — gaxios calls `uuid.v4()` without a `buf` argument.
**Action:** revisit when uuid 14.0.0 publishes or when gaxios bumps. Tracked in PR #3.

### 5.2 Pre-existing typecheck/lint debt
None as of PR #6 — verified clean. If this drifts, gate with §4.3 CI.

---

## 6. Long-term roadmap

### 6.1 Register a real `intacct_query_agent` model
The infra bundle declares `registered_models: intacct_query_agent` as a UC placeholder. The actual agent — an LLM that maps natural-language questions to MCP tool calls and summarizes results — is unbuilt. Build it with MLflow 3 + the `intacct_traces` experiment.

### 6.2 Cross-account / multi-workspace support
Today the project assumes one Databricks workspace per environment (dev, hls_fde, prod). For customer rollouts, parameterize the bundles so a single repo can target N workspaces.

### 6.3 Sage Marketplace partner certification
If we go deep on §1.4 (consume Sage's MCP) and add write-path tools, certifying the Databricks app as a Sage Marketplace integration unlocks the Sage Copilot distribution path.

---

## How this doc is updated

- Every PR that closes an item should remove it (or strike-through with a link to the merged PR).
- Every PR that adds significant new work should add a new item here.
- Reorder sections as the priority shifts.
