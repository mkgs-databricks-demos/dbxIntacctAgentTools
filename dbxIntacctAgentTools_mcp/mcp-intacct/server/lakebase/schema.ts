/**
 * Lakebase Postgres schema for the Intacct MCP server.
 *
 * Two operational tables, both lightweight and idempotent:
 *
 *   tenant_registry — one row per Sage Intacct company the app serves.
 *     Drives loadTenant() validation and the admin UI tenant list.
 *
 *   mcp_call_log    — one row per MCP tool invocation. Hot-path writes
 *     for the admin UI and recent-call audit. A future Lakeflow Job can
 *     stream this into the UC Delta `mcp_call_log` table for analytics.
 *
 * The initSchema() helper runs at app startup and is idempotent — safe
 * to run on every cold-start. Each statement is wrapped in CREATE TABLE
 * IF NOT EXISTS / CREATE INDEX IF NOT EXISTS so adding new columns
 * later is a controlled migration.
 */

import type { Pool } from 'pg';

const STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS tenant_registry (
    tenant_id            TEXT PRIMARY KEY,
    company_id           TEXT NOT NULL,
    display_name         TEXT NOT NULL,
    user_secret_key      TEXT NOT NULL,
    password_secret_key  TEXT NOT NULL,
    enabled              BOOLEAN NOT NULL DEFAULT true,
    writes_enabled       BOOLEAN NOT NULL DEFAULT false,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
  `,
  // Migration: add writes_enabled column to existing tenant_registry tables.
  // Postgres ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent.
  `
  ALTER TABLE tenant_registry
    ADD COLUMN IF NOT EXISTS writes_enabled BOOLEAN NOT NULL DEFAULT false
  `,
  `CREATE INDEX IF NOT EXISTS tenant_registry_company_id_idx ON tenant_registry (company_id)`,
  `CREATE INDEX IF NOT EXISTS tenant_registry_enabled_idx    ON tenant_registry (enabled)`,
  `
  CREATE TABLE IF NOT EXISTS mcp_call_log (
    call_id              TEXT PRIMARY KEY,
    request_id           TEXT,
    tenant_id            TEXT,
    user_id              TEXT,
    tool_name            TEXT NOT NULL,
    tool_input           JSONB,
    tool_output_summary  TEXT,
    sage_calls_made      INT,
    latency_ms           BIGINT,
    status               TEXT NOT NULL,
    error_message        TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
  `,
  `CREATE INDEX IF NOT EXISTS mcp_call_log_created_at_idx ON mcp_call_log (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS mcp_call_log_tenant_id_idx  ON mcp_call_log (tenant_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS mcp_call_log_tool_name_idx  ON mcp_call_log (tool_name, created_at DESC)`,
];

/** Run idempotent schema migrations. Safe to call on every app startup. */
export async function initSchema(pool: Pool): Promise<void> {
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
}
