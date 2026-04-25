/**
 * Shared helpers for MCP tool handlers.
 *
 * Each tool resolves its tenant client, calls one IntacctClient method,
 * and returns the result formatted for MCP. Errors are caught and
 * surfaced to the caller as a typed text payload rather than thrown
 * (the MCP transport handles thrown errors but text-shaped failures are
 * easier for downstream agents to interpret).
 */

import { getTenantClient, IntacctError } from '../../intacct/index.js';

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Run an Intacct call against the tenant's client and format the
 * result. Catches IntacctError and surfaces it as a structured error
 * payload.
 */
export async function runTenantCall<T>(
  tenantId: string,
  fn: (client: Awaited<ReturnType<typeof getTenantClient>>) => Promise<T>,
): Promise<ToolTextResult> {
  try {
    const client = await getTenantClient(tenantId);
    const result = await fn(client);
    return formatJson(result);
  } catch (err) {
    return formatError(err, { tenantId });
  }
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
