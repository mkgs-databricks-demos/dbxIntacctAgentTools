/**
 * MCP call log — one row per tool invocation.
 *
 * Writes are best-effort: the call returns to the user even if the log
 * write fails (we surface the failure to console, not the caller).
 */

import type { Pool } from 'pg';

export interface RecentCallRow {
  callId: string;
  requestId: string | null;
  tenantId: string | null;
  userId: string | null;
  toolName: string;
  toolInput: unknown;
  toolOutputSummary: string | null;
  sageCallsMade: number | null;
  latencyMs: number;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
}

export interface RecentQuery {
  tenantId?: string;
  toolName?: string;
  status?: 'success' | 'error';
  limit?: number;
  offset?: number;
}

export interface RecentPage {
  rows: RecentCallRow[];
  total: number;
  limit: number;
  offset: number;
}

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

  /** Distinct tool names that have been logged — for the filter dropdown. */
  async distinctToolNames(): Promise<string[]> {
    const result = await this.pool.query<{ tool_name: string }>(
      `SELECT DISTINCT tool_name FROM mcp_call_log ORDER BY tool_name`,
    );
    return result.rows.map((r) => r.tool_name);
  }

  /**
   * Paginated MCP tool invocations for the admin UI.
   *
   * Filters: tenantId, toolName, status (success|error).
   * Pagination: limit + offset. Returns the total row count matching
   * the filters so the UI can render Prev/Next + page indicator.
   */
  async recent(query: RecentQuery = {}): Promise<RecentPage> {
    const { tenantId, toolName, status, limit = 50, offset = 0 } = query;
    const filters: string[] = [];
    const filterArgs: unknown[] = [];
    if (tenantId) {
      filterArgs.push(tenantId);
      filters.push(`tenant_id = $${filterArgs.length}`);
    }
    if (toolName) {
      filterArgs.push(toolName);
      filters.push(`tool_name = $${filterArgs.length}`);
    }
    if (status) {
      filterArgs.push(status);
      filters.push(`status = $${filterArgs.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const totalResult = await this.pool.query<{ total: string | number }>(
      `SELECT COUNT(*)::bigint AS total FROM mcp_call_log ${where}`,
      filterArgs,
    );
    const total = Number(totalResult.rows[0]?.total ?? 0);

    const pageArgs = [...filterArgs, limit, offset];
    const limitParam = `$${pageArgs.length - 1}`;
    const offsetParam = `$${pageArgs.length}`;
    const result = await this.pool.query<{
      call_id: string;
      request_id: string | null;
      tenant_id: string | null;
      user_id: string | null;
      tool_name: string;
      tool_input: unknown;
      tool_output_summary: string | null;
      sage_calls_made: number | null;
      latency_ms: string | number;
      status: string;
      error_message: string | null;
      created_at: Date;
    }>(
      `SELECT call_id, request_id, tenant_id, user_id, tool_name, tool_input,
              tool_output_summary, sage_calls_made, latency_ms, status,
              error_message, created_at
         FROM mcp_call_log
         ${where}
        ORDER BY created_at DESC
        LIMIT ${limitParam}
       OFFSET ${offsetParam}`,
      pageArgs,
    );
    return {
      rows: result.rows.map((row) => ({
        callId: row.call_id,
        requestId: row.request_id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        toolName: row.tool_name,
        toolInput: row.tool_input,
        toolOutputSummary: row.tool_output_summary,
        sageCallsMade: row.sage_calls_made,
        latencyMs: Number(row.latency_ms),
        status: row.status,
        errorMessage: row.error_message,
        createdAt: row.created_at,
      })),
      total,
      limit,
      offset,
    };
  }
}
