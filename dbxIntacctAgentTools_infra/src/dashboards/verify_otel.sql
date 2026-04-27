-- OpenTelemetry verification queries for the Intacct MCP app.
-- Run these against the workspace's SQL editor (or via
-- `databricks bundle run` once we wrap them in a job task) after
-- deploying the app and exercising one MCP tool call.
--
-- Expected outcome:
--   1. All three SHOW TABLE queries return a non-empty result.
--   2. The COUNT queries return rows > 0 within ~60s of the app's
--      first request.
--   3. The shape queries return the expected columns.
--
-- If any of these fail, the most common causes are:
--   * App hasn't received any traffic yet — exercise an MCP tool.
--   * `telemetry_export_destinations` missing on the app resource
--     (verify in `dbxIntacctAgentTools_mcp/resources/intacct_mcp.app.yml`).
--   * The app's SPN doesn't have CREATE TABLE privilege on the
--     target schema. The platform creates the OTel tables lazily on
--     the first emit; this is the silent failure mode.

-- Replace the placeholders below with your bundle target's catalog/schema.
-- Or use SET VARIABLE in the SQL editor.

-- ── 1. Tables exist ────────────────────────────────────────────────
SHOW TABLES IN hls_fde_dev.intacct LIKE '%_otel_%';

DESCRIBE TABLE hls_fde_dev.intacct.app_otel_traces;
DESCRIBE TABLE hls_fde_dev.intacct.app_otel_logs;
DESCRIBE TABLE hls_fde_dev.intacct.app_otel_metrics;

-- ── 2. Each table has rows ─────────────────────────────────────────
SELECT 'traces' AS source, COUNT(*) AS rows
  FROM hls_fde_dev.intacct.app_otel_traces
UNION ALL
SELECT 'logs',   COUNT(*) FROM hls_fde_dev.intacct.app_otel_logs
UNION ALL
SELECT 'metrics', COUNT(*) FROM hls_fde_dev.intacct.app_otel_metrics;

-- ── 3. Most recent activity ────────────────────────────────────────
SELECT MAX(start_time)    AS latest_trace
  FROM hls_fde_dev.intacct.app_otel_traces;

SELECT MAX(observed_time) AS latest_log
  FROM hls_fde_dev.intacct.app_otel_logs;

SELECT MAX(time)          AS latest_metric_sample
  FROM hls_fde_dev.intacct.app_otel_metrics;

-- ── 4. App instrumentation working — one trace per MCP tool call ──
SELECT
  service_name,
  span_name,
  COUNT(*) AS spans,
  AVG(duration_nano / 1e6) AS avg_ms
FROM hls_fde_dev.intacct.app_otel_traces
WHERE start_time >= NOW() - INTERVAL 1 HOUR
GROUP BY service_name, span_name
ORDER BY spans DESC
LIMIT 20;

-- ── 5. Span sample (first 5 from the last hour) ────────────────────
SELECT
  trace_id,
  span_id,
  service_name,
  span_name,
  status_code,
  start_time,
  duration_nano / 1e6 AS duration_ms
FROM hls_fde_dev.intacct.app_otel_traces
WHERE start_time >= NOW() - INTERVAL 1 HOUR
ORDER BY start_time DESC
LIMIT 5;
