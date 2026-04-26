-- Databricks notebook source
-- Bootstrap DDL for Intacct Agent analytical tables.
-- Idempotent — safe to re-run.
--
-- Job parameters available:
--   ${catalog_use}            — Unity Catalog catalog
--   ${schema_use}             — Unity Catalog schema
--   ${spn_application_id}     — Intacct app SPN (from task 1)

USE CATALOG IDENTIFIER(:catalog_use);
USE SCHEMA  IDENTIFIER(:schema_use);

-- ────────────────────────────────────────────────────────────────────────
-- mcp_call_log — every MCP tool invocation against the server
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_call_log (
  call_id              STRING NOT NULL,
  request_id           STRING,
  tenant_id            STRING,
  user_id              STRING,
  tool_name            STRING NOT NULL,
  tool_input           VARIANT,
  tool_output_summary  STRING,
  sage_calls_made      INT,
  latency_ms           BIGINT,
  status               STRING,
  error_message        STRING,
  created_at           TIMESTAMP NOT NULL
)
USING DELTA
CLUSTER BY (created_at, tool_name, tenant_id)
COMMENT 'Every MCP tool invocation against the Intacct MCP server.';

-- ────────────────────────────────────────────────────────────────────────
-- agent_traces — high-level agent runs (multi-tool, multi-turn)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_traces (
  trace_id             STRING NOT NULL,
  user_id              STRING,
  tenant_id            STRING,
  question             STRING,
  final_answer         STRING,
  tools_called         ARRAY<STRING>,
  total_calls          INT,
  total_latency_ms     BIGINT,
  status               STRING,
  created_at           TIMESTAMP NOT NULL
)
USING DELTA
CLUSTER BY (created_at, tenant_id)
COMMENT 'Agent-level traces aggregating one or more MCP tool calls.';

-- ────────────────────────────────────────────────────────────────────────
-- tenant_registry_audit — append-only log of tenant config changes
-- (mirror of the OLTP tenant_registry table in Lakebase, for analytics)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_registry_audit (
  audit_id             STRING NOT NULL,
  tenant_id            STRING NOT NULL,
  company_id           STRING,
  display_name         STRING,
  user_secret_key      STRING,
  password_secret_key  STRING,
  enabled              BOOLEAN,
  changed_by           STRING,
  change_type          STRING,
  changed_at           TIMESTAMP NOT NULL
)
USING DELTA
CLUSTER BY (changed_at, tenant_id)
COMMENT 'Append-only audit log of tenant registry mutations.';

-- ────────────────────────────────────────────────────────────────────────
-- raw_response_index — pointer-row table for raw API payloads landed in volumes
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raw_response_index (
  request_id           STRING NOT NULL,
  tenant_id            STRING NOT NULL,
  endpoint             STRING NOT NULL,
  method               STRING,
  http_status          INT,
  volume_path          STRING NOT NULL,
  bytes                BIGINT,
  created_at           TIMESTAMP NOT NULL
)
USING DELTA
CLUSTER BY (created_at, tenant_id, endpoint)
COMMENT 'Pointer table for raw Sage Intacct API responses landed in /Volumes/.../raw_responses/.';

-- ────────────────────────────────────────────────────────────────────────
-- Grants for the Intacct Agent SPN
-- ────────────────────────────────────────────────────────────────────────
GRANT USE CATALOG ON CATALOG IDENTIFIER(:catalog_use) TO `${spn_application_id}`;
GRANT USE SCHEMA, MODIFY, SELECT ON SCHEMA IDENTIFIER(CONCAT(:catalog_use, '.', :schema_use)) TO `${spn_application_id}`;
GRANT MODIFY, SELECT ON TABLE mcp_call_log TO `${spn_application_id}`;
GRANT MODIFY, SELECT ON TABLE agent_traces TO `${spn_application_id}`;
GRANT MODIFY, SELECT ON TABLE tenant_registry_audit TO `${spn_application_id}`;
GRANT MODIFY, SELECT ON TABLE raw_response_index TO `${spn_application_id}`;
