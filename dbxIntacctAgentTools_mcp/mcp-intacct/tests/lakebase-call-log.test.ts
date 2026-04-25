/**
 * Vitest suite for the CallLog.
 *
 * Confirms that record() writes the expected row and that persistence
 * failures are swallowed (don't throw to the caller).
 */

import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { CallLog } from '../server/lakebase/mcp_call_log.js';

function mockPool(query: ReturnType<typeof vi.fn>): Pool {
  return { query } as unknown as Pool;
}

describe('CallLog.record', () => {
  it('inserts a row with the expected column order', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const log = new CallLog(mockPool(query));

    await log.record({
      callId: 'c1',
      requestId: 'r1',
      tenantId: 'acmecorp',
      userId: 'u1',
      toolName: 'list_gl_accounts',
      toolInput: { tenant_id: 'acmecorp', max_results: 50 },
      toolOutputSummary: 'array of 50 item(s)',
      sageCallsMade: 1,
      latencyMs: 123.7,
      status: 'success',
    });

    expect(query).toHaveBeenCalledTimes(1);
    const args = query.mock.calls[0][1] as unknown[];
    expect(args[0]).toBe('c1');                       // call_id
    expect(args[1]).toBe('r1');                       // request_id
    expect(args[2]).toBe('acmecorp');                 // tenant_id
    expect(args[3]).toBe('u1');                       // user_id
    expect(args[4]).toBe('list_gl_accounts');         // tool_name
    expect(args[5]).toBe(JSON.stringify({ tenant_id: 'acmecorp', max_results: 50 }));
    expect(args[6]).toBe('array of 50 item(s)');      // tool_output_summary
    expect(args[7]).toBe(1);                          // sage_calls_made
    expect(args[8]).toBe(124);                        // latency_ms (rounded)
    expect(args[9]).toBe('success');                  // status
    expect(args[10]).toBeNull();                      // error_message
  });

  it('serializes nullable fields as null', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const log = new CallLog(mockPool(query));

    await log.record({
      callId: 'c2',
      toolName: 'get_journal_entry',
      latencyMs: 10,
      status: 'error',
      errorMessage: 'boom',
    });

    const args = query.mock.calls[0][1] as unknown[];
    expect(args[1]).toBeNull(); // request_id
    expect(args[2]).toBeNull(); // tenant_id
    expect(args[3]).toBeNull(); // user_id
    expect(args[5]).toBeNull(); // tool_input
    expect(args[6]).toBeNull(); // tool_output_summary
    expect(args[7]).toBeNull(); // sage_calls_made
    expect(args[10]).toBe('boom'); // error_message
  });

  it('swallows persistence failures (does not throw)', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection refused'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new CallLog(mockPool(query));

    await expect(
      log.record({ callId: 'c3', toolName: 'whatever', latencyMs: 0, status: 'success' }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
