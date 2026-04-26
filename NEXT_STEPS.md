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
**Status:** Blocked on auto-regen. Two unblocked paths documented; both end at the same outcome.
**What:** the TS client methods currently return `Record<string, unknown>`; the Python SDK works against `dict[str, Any]`. Both should expose typed models so MCP tool callers and Lakeflow Job authors get compile-time field safety.
**The blocker:** Sage's developer portal (`developer.sage.com`) is fronted by Cloudflare and 403s every automated request — `curl`, `WebFetch`, custom-User-Agent variants all rejected. The regen scripts are wired and ready (`mcp-intacct/scripts/regenerate_intacct_client.sh` and `dbxIntacctAgentTools_sdk/scripts/regenerate_client.sh`), but they can't fetch the spec on their own.
**Two paths forward:** detailed step-by-step instructions, including what to type/where to put it, are in:
- TypeScript / MCP server: [`dbxIntacctAgentTools_mcp/mcp-intacct/server/intacct/_generated/README.md`](dbxIntacctAgentTools_mcp/mcp-intacct/server/intacct/_generated/README.md)
- Python SDK: [`dbxIntacctAgentTools_sdk/src/intacct_sdk/_generated/README.md`](dbxIntacctAgentTools_sdk/src/intacct_sdk/_generated/README.md)

Each README documents:
- **Option A** — hand-craft minimal types (TypeScript interfaces / Pydantic v2 models) for the curated method surface (~6 methods × 2 SDKs)
- **Option B** — manual spec download from a browser, then run the regen script with `--spec <local-path>` for full surface coverage
**Why:** removes "field doesn't exist" errors from MCP tool code; lets the MCP server emit richer `outputSchema` to AI Playground and other clients.
**Effort:** Option A — 1 PR per SDK (~half day each). Option B — same plus one manual download per Sage release.

### 1.2 Build out the AP / Cash MCP tools — ✅ done in #10
**What done:** four new tools — `list_vendors`, `list_bills`, `list_payments`, `get_cash_position` — added to `server/mcp/tools/{accounts_payable,cash}.ts`. Surface goes from 6 → 10 tools across 4 domains. Backed by `IntacctClient.{listVendors,listBills,listPayments,getCashPosition}` with full filter forwarding and pagination. Tests in `tests/intacct-client-ap-cash.test.ts` (7 specs, including a fix that threads a single mocked `fetch` through both auth and REST calls).

### 1.3 Add write-path MCP tools — ✅ done in #14
**What done:** three write tools landed — `post_journal_entry`, `record_adjustment`, `apply_payment`. All gated by `tenant_registry.writes_enabled` via a new `runTenantCall({ requireWrites: true }, ...)` option that calls `registry.requireWritable()` before invoking Sage. Each tool accepts an optional `idempotency_key` argument forwarded as the `Idempotency-Key` HTTP header so retries don't double-post. `IntacctClient.request()` extended to thread the header through. Tool surface now 13 across 5 domains.
**Remaining:** rollback semantics on partial-failure batch posts (e.g. journal entry that posts but Sage 5xxs after) — defer until a real Sage sandbox surfaces this scenario.

### 1.4 Consume the official Sage Intacct MCP server
**What:** Sage shipped their own MCP at `developer.sage.com/intacct/mcps/intacct-mcp/...` in Nov 2025. Evaluate whether this server should call it (as a Databricks-side façade), and which procedures we'd thin out.
**Why:** less code to maintain if Sage's surface covers what we need; Sage Copilot ecosystem alignment.
**Effort:** medium — research first, then decide build vs. delegate.

---

## 2. Observability

### 2.1 Raw-response capture to the `raw_responses` UC Volume
**Status:** Volume writes done in #8; Delta pointer row remains.
**What done (#8):** `RawResponseWriter` wired to AppKit's `files` plugin, drops every Sage REST round-trip as `<tenant_id>/<YYYY-MM-DD>/<request_id>.json` in the volume.
**What remains:** insert a pointer row into the UC `raw_response_index` Delta table on each capture (request_id, tenant_id, endpoint, method, http_status, volume_path, bytes, captured_at) so SQL queries can find captures without listing the volume.
**Why:** the table is the analytical entry-point for replay/debugging; the volume alone needs `LIST` to discover captures.
**Effort:** small — Statement Execution API call from the writer. AppKit's `analytics` plugin is read-only, so use the Databricks SDK directly.

### 2.2 Stream `mcp_call_log` from Lakebase → UC Delta — ✅ done in #15
**What done:** new `intacct_mcp_call_log_sync` Lakeflow Job in the infra bundle. Watermark-driven incremental copy: reads `MAX(created_at)` from the UC Delta target, fetches Lakebase rows newer than that (capped by `batch_size=5000`), parses `tool_input` JSONB through `parse_json`, appends to Delta. Schedule cron `0 0/15 * * * ?` PAUSED by default — flip via UI when downstream consumers are wired. Connects to Lakebase via OAuth-rotated Postgres using `psycopg`. Side-fix: bundle validate was failing on the existing UC setup job because `target-tables-ddl.sql` lacked the `-- Databricks notebook source` header; added it. `databricks bundle validate --target dev` now passes.

### 2.3 Verify OTel telemetry export
**What:** the `intacct_mcp.app.yml` declares `telemetry_export_destinations` for `app_otel_logs`/`_traces`/`_metrics`. After first deploy, confirm the three Delta tables get populated and add a default Lakeview dashboard.
**Why:** built-in OTel is free; just need to confirm it works and surface it.
**Effort:** small.
**Prereq:** infra deployed.

### 2.4 Pagination + filtering on the Recent Calls UI — ✅ done in #13
**What done:** `mcpCallLog.recent` returns `{ rows, total, limit, offset }` and accepts `status: 'success'|'error'` + `offset` filters. New `mcpCallLog.toolNames` query feeds the tool dropdown. RecentCalls.tsx now has tenant/tool/status filter inputs and Prev/Next pagination with a "1–25 of 137" indicator. Zod validation hard-caps `limit` at 500 and rejects negative offsets / unknown status values.

---

## 3. Auth / security hardening

### 3.1 OBO auth on tRPC procedures — ✅ done in #11
**What done:** `tenants.upsert` and `tenants.disable` are now wrapped in `adminProcedure`, which throws `UNAUTHORIZED` unless the request's `x-forwarded-user` header matches the comma-separated allow-list in `INTACCT_MCP_ADMIN_USERS`. New `whoami` query exposes `{ userId, isAdmin, isAuthenticated }`. The React UI hides Edit/Disable buttons and the Add-tenant button for non-admins, shows a role badge in the header, and a "read-only" notice on the Tenants page. Dev-mode escape hatches: `MCP_DEV_USER` env var supplies a fallback identity, and `INTACCT_MCP_ADMIN_USERS=*` is honored only when `NODE_ENV=development`.

### 3.2 Validate the Sage Intacct REST auth flow against a real sandbox
**What:** `IntacctAuth` was written from documentation, not a live exchange. The exact body keys (`grant_type`, `sender_id`, etc.) and endpoint URL need a smoke test against a Sage sandbox.
**Why:** we'll find out exactly what the auth endpoint expects only by hitting it.
**Effort:** small (just runtime verification).
**Prereq:** Sage sandbox + credentials.

### 3.3 Tenant write allow-list flag — ✅ done in #12
**What done:** `tenant_registry` gained a `writes_enabled BOOLEAN NOT NULL DEFAULT false` column (idempotent ALTER TABLE migration). `TenantRegistry.requireWritable(tenantId)` throws unless the flag is true. `TenantRecord` and `TenantUpsertInput` carry the flag through to the tRPC layer. Admin UI: TenantList shows a `writable | read-only` badge; TenantForm has a "Writes enabled" checkbox (default unchecked = safe). Tests assert default-false on upsert, propagation when set, and `requireWritable` throws on missing/disabled/non-writable. §1.3 write-path MCP tools will call `registry.requireWritable()` before invoking Sage.

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
