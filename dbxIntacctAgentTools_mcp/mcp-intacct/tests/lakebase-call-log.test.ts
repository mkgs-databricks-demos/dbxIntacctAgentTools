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

describe('CallLog.recent (pagination + filters)', () => {
  /** Build a query mock that returns count, then rows. */
  function pagedQueryMock(opts: { total: number; rows: unknown[] }): ReturnType<typeof vi.fn> {
    return vi
      .fn()
      // First call: SELECT COUNT(*)
      .mockResolvedValueOnce({ rows: [{ total: opts.total }], rowCount: 1 })
      // Second call: SELECT ... LIMIT n OFFSET m
      .mockResolvedValueOnce({ rows: opts.rows, rowCount: opts.rows.length });
  }

  const SAMPLE_ROW = {
    call_id: 'c1',
    request_id: null,
    tenant_id: 'acmecorp',
    user_id: null,
    tool_name: 'list_gl_accounts',
    tool_input: {},
    tool_output_summary: null,
    sage_calls_made: 1,
    latency_ms: 42,
    status: 'success',
    error_message: null,
    created_at: new Date('2026-04-26T01:00:00Z'),
  };

  it('returns total + page rows + echoes limit/offset', async () => {
    const query = pagedQueryMock({ total: 137, rows: [SAMPLE_ROW] });
    const log = new CallLog(mockPool(query));

    const page = await log.recent({ limit: 25, offset: 50 });

    expect(page.total).toBe(137);
    expect(page.limit).toBe(25);
    expect(page.offset).toBe(50);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.callId).toBe('c1');
  });

  it('forwards tenantId, toolName, status as filter args', async () => {
    const query = pagedQueryMock({ total: 0, rows: [] });
    const log = new CallLog(mockPool(query));

    await log.recent({
      tenantId: 'acmecorp',
      toolName: 'list_gl_accounts',
      status: 'error',
      limit: 10,
      offset: 0,
    });

    // First call (COUNT): args = [tenantId, toolName, status]
    const countArgs = query.mock.calls[0][1] as unknown[];
    expect(countArgs).toEqual(['acmecorp', 'list_gl_accounts', 'error']);

    // Second call (SELECT): args = [...filters, limit, offset]
    const pageArgs = query.mock.calls[1][1] as unknown[];
    expect(pageArgs).toEqual(['acmecorp', 'list_gl_accounts', 'error', 10, 0]);
  });

  it('omits a WHERE clause when no filters are provided', async () => {
    const query = pagedQueryMock({ total: 5, rows: [] });
    const log = new CallLog(mockPool(query));

    await log.recent();

    const countSql = String(query.mock.calls[0][0]);
    expect(countSql).not.toMatch(/WHERE/);
  });

  it('uses defaults limit=50 / offset=0 when not provided', async () => {
    const query = pagedQueryMock({ total: 0, rows: [] });
    const log = new CallLog(mockPool(query));

    const page = await log.recent();

    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
  });
});

describe('CallLog.distinctToolNames', () => {
  it('returns rows from SELECT DISTINCT tool_name', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { tool_name: 'get_journal_entry' },
        { tool_name: 'list_gl_accounts' },
      ],
      rowCount: 2,
    });
    const log = new CallLog(mockPool(query));

    const names = await log.distinctToolNames();

    expect(names).toEqual(['get_journal_entry', 'list_gl_accounts']);
  });
});
