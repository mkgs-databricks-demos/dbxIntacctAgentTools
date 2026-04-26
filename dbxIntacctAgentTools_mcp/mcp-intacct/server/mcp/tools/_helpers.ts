/**
 * Shared helpers for MCP tool handlers.
 *
 * Each tool resolves its tenant client, calls one IntacctClient method,
 * formats the result for MCP, and persists a row to the Lakebase
 * mcp_call_log so the admin UI / audit pipeline can observe it.
 *
 * Errors from the Intacct call are surfaced as a structured text
 * payload with `isError: true` rather than thrown — keeps the MCP
 * transport happy and gives downstream agents structured failure info.
 *
 * Errors from the call-log write are swallowed (logged to console)
 * so a logging outage never blocks user-facing requests.
 */

import { randomUUID } from 'node:crypto';

import { getLakebase } from '../../lakebase/index.js';
import { getTenantClient, IntacctError } from '../../intacct/index.js';

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  // MCP SDK's ToolCallback expects an index signature on the return type.
  [key: string]: unknown;
}

interface RunOptions {
  toolName: string;
  toolInput: Record<string, unknown>;
  /** When provided, lets the caller skip the implicit tenant_id parsing. */
  tenantId?: string;
  /**
   * When true, calls registry.requireWritable(tenantId) before resolving
   * the tenant client. Throws (and produces a structured error result)
   * if the tenant has writes_enabled=false. Defaults to false.
   */
  requireWrites?: boolean;
}

/**
 * Run an Intacct call against the tenant's client, format the result
 * for MCP, and write a row to mcp_call_log.
 */
export async function runTenantCall<T>(
  opts: RunOptions,
  fn: (client: Awaited<ReturnType<typeof getTenantClient>>) => Promise<T>,
): Promise<ToolTextResult> {
  const tenantId = opts.tenantId ?? (opts.toolInput.tenant_id as string | undefined) ?? '';
  const callId = randomUUID();
  const startedAt = Date.now();

  let result: ToolTextResult;
  try {
    if (opts.requireWrites) {
      await getLakebase().registry.requireWritable(tenantId);
    }
    const client = await getTenantClient(tenantId);
    const value = await fn(client);
    result = formatJson(value);
    await persist({
      callId,
      tenantId,
      toolName: opts.toolName,
      toolInput: opts.toolInput,
      latencyMs: Date.now() - startedAt,
      status: 'success',
      toolOutputSummary: summarize(value),
    });
  } catch (err) {
    result = formatError(err, { tenantId });
    await persist({
      callId,
      tenantId,
      toolName: opts.toolName,
      toolInput: opts.toolInput,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
  return result;
}

/** Format any JSON-serializable value as an MCP text result. */
export function formatJson(value: unknown): ToolTextResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function formatError(err: unknown, context: Record<string, unknown> = {}): ToolTextResult {
  const message = err instanceof Error ? err.message : String(err);
  const statusCode = err instanceof IntacctError ? err.statusCode : undefined;
  const payload = err instanceof IntacctError ? err.payload : undefined;
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: message, statusCode, payload, ...context }, null, 2),
      },
    ],
  };
}

async function persist(row: {
  callId: string;
  tenantId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  latencyMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
  toolOutputSummary?: string;
}): Promise<void> {
  try {
    const { callLog } = getLakebase();
    await callLog.record({
      callId: row.callId,
      tenantId: row.tenantId || undefined,
      toolName: row.toolName,
      toolInput: row.toolInput,
      latencyMs: row.latencyMs,
      status: row.status,
      errorMessage: row.errorMessage,
      toolOutputSummary: row.toolOutputSummary,
    });
  } catch (err) {
    console.error('[mcp_call_log] failed:', err);
  }
}

function summarize(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return `array of ${value.length} item(s)`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `object with ${keys.length} key(s): ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '…' : ''}`;
  }
  if (typeof value === 'string') {
    return value.slice(0, 200);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}
