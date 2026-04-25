/**
 * MCP call log — one row per tool invocation.
 *
 * Writes are best-effort: the call returns to the user even if the log
 * write fails (we surface the failure to console, not the caller).
 */

import type { Pool } from 'pg';

export interface CallLogEntry {
  callId: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  toolName: string;
  toolInput?: unknown;
  toolOutputSummary?: string;
  sageCallsMade?: number;
  latencyMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
}

export class CallLog {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Insert one call-log row. Logs (does not throw) on persistence failure
   * — the caller's tool result is more important than the audit row.
   */
  async record(entry: CallLogEntry): Promise<void> {
    try {
      await this.pool.query(
        `
        INSERT INTO mcp_call_log
          (call_id, request_id, tenant_id, user_id, tool_name, tool_input,
           tool_output_summary, sage_calls_made, latency_ms, status, error_message)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
        `,
        [
          entry.callId,
          entry.requestId ?? null,
          entry.tenantId ?? null,
          entry.userId ?? null,
          entry.toolName,
          entry.toolInput !== undefined ? JSON.stringify(entry.toolInput) : null,
          entry.toolOutputSummary ?? null,
          entry.sageCallsMade ?? null,
          Math.round(entry.latencyMs),
          entry.status,
          entry.errorMessage ?? null,
        ],
      );
    } catch (err) {
      console.error('[mcp_call_log] failed to persist call log entry:', err);
    }
  }
}
