/**
 * Vitest suite for the admin tRPC router.
 *
 * Builds a server-side caller via appRouter.createCaller(ctx) and
 * exercises each procedure against mocked Lakebase services.
 */

import { describe, it, expect, vi } from 'vitest';
import { appRouter } from '../server/trpc/router.js';
import { createTestContext } from '../server/trpc/context.js';
import type { LakebaseServices } from '../server/lakebase/index.js';

function fakeLakebase(overrides: Partial<{
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  disable: ReturnType<typeof vi.fn>;
  recent: ReturnType<typeof vi.fn>;
  distinctToolNames: ReturnType<typeof vi.fn>;
}> = {}): LakebaseServices {
  return {
    registry: {
      list: overrides.list ?? vi.fn().mockResolvedValue([]),
      get: overrides.get ?? vi.fn().mockResolvedValue(null),
      upsert: overrides.upsert ?? vi.fn().mockResolvedValue(null),
      disable: overrides.disable ?? vi.fn().mockResolvedValue(null),
      require: vi.fn(),
      requireWritable: vi.fn(),
      _clearCache: vi.fn(),
    } as unknown as LakebaseServices['registry'],
    callLog: {
      record: vi.fn(),
      recent:
        overrides.recent ??
        vi.fn().mockResolvedValue({ rows: [], total: 0, limit: 25, offset: 0 }),
      distinctToolNames: overrides.distinctToolNames ?? vi.fn().mockResolvedValue([]),
    } as unknown as LakebaseServices['callLog'],
  };
}

describe('tRPC tenants', () => {
  it('list returns the registry list', async () => {
    const list = vi.fn().mockResolvedValue([
      {
        tenantId: 'a',
        companyId: 'a',
        displayName: 'Acme',
        userSecretKey: 'intacct_user_a',
        passwordSecretKey: 'intacct_password_a',
        enabled: true,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const lakebase = fakeLakebase({ list });
    const caller = appRouter.createCaller(createTestContext(lakebase));

    const result = await caller.tenants.list();

    expect(result).toHaveLength(1);
    expect(result[0]?.displayName).toBe('Acme');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('get forwards the tenantId argument', async () => {
    const get = vi.fn().mockResolvedValue(null);
    const lakebase = fakeLakebase({ get });
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await caller.tenants.get({ tenantId: 'acme' });

    expect(get).toHaveBeenCalledWith('acme');
  });

  it('upsert validates and forwards the input', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const lakebase = fakeLakebase({ upsert });
    const caller = appRouter.createCaller(
      createTestContext(lakebase, { isAdmin: true, userId: 'admin@example.com' }),
    );

    await caller.tenants.upsert({
      tenantId: 'acme',
      companyId: 'acmecorp',
      displayName: 'Acme Corp',
    });

    expect(upsert).toHaveBeenCalledWith({
      tenantId: 'acme',
      companyId: 'acmecorp',
      displayName: 'Acme Corp',
    });
  });

  it('upsert rejects invalid input', async () => {
    const lakebase = fakeLakebase();
    const caller = appRouter.createCaller(
      createTestContext(lakebase, { isAdmin: true, userId: 'admin@example.com' }),
    );

    // tenantId too long (>64 chars)
    await expect(
      caller.tenants.upsert({
        tenantId: 'x'.repeat(100),
        companyId: 'acmecorp',
        displayName: 'Acme Corp',
      }),
    ).rejects.toThrow();
  });

  it('disable forwards the tenantId argument', async () => {
    const disable = vi.fn().mockResolvedValue({ tenantId: 'acme', enabled: false });
    const lakebase = fakeLakebase({ disable });
    const caller = appRouter.createCaller(
      createTestContext(lakebase, { isAdmin: true, userId: 'admin@example.com' }),
    );

    await caller.tenants.disable({ tenantId: 'acme' });

    expect(disable).toHaveBeenCalledWith('acme');
  });
});

describe('tRPC mcpCallLog.recent', () => {
  const EMPTY_PAGE = { rows: [], total: 0, limit: 25, offset: 0 };

  it('forwards filters with defaults (limit=25 / offset=0)', async () => {
    const recent = vi.fn().mockResolvedValue(EMPTY_PAGE);
    const lakebase = fakeLakebase({ recent });
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await caller.mcpCallLog.recent();

    expect(recent).toHaveBeenCalledWith({
      tenantId: undefined,
      toolName: undefined,
      status: undefined,
      limit: 25,
      offset: 0,
    });
  });

  it('forwards tenant + tool + status + offset filters', async () => {
    const recent = vi.fn().mockResolvedValue(EMPTY_PAGE);
    const lakebase = fakeLakebase({ recent });
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await caller.mcpCallLog.recent({
      tenantId: 'acme',
      toolName: 'list_gl_accounts',
      status: 'error',
      limit: 10,
      offset: 100,
    });

    expect(recent).toHaveBeenCalledWith({
      tenantId: 'acme',
      toolName: 'list_gl_accounts',
      status: 'error',
      limit: 10,
      offset: 100,
    });
  });

  it('caps limit at 500 via zod validation', async () => {
    const lakebase = fakeLakebase();
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await expect(caller.mcpCallLog.recent({ limit: 5_000 })).rejects.toThrow();
  });

  it('rejects negative offsets', async () => {
    const lakebase = fakeLakebase();
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await expect(caller.mcpCallLog.recent({ offset: -1 })).rejects.toThrow();
  });

  it('rejects unknown status values', async () => {
    const lakebase = fakeLakebase();
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await expect(
      caller.mcpCallLog.recent({ status: 'pending' as unknown as 'success' }),
    ).rejects.toThrow();
  });
});

describe('tRPC mcpCallLog.toolNames', () => {
  it('returns the distinct tool names from the call log', async () => {
    const distinctToolNames = vi
      .fn()
      .mockResolvedValue(['get_journal_entry', 'list_gl_accounts']);
    const lakebase = fakeLakebase({ distinctToolNames });
    const caller = appRouter.createCaller(createTestContext(lakebase));

    const names = await caller.mcpCallLog.toolNames();

    expect(names).toEqual(['get_journal_entry', 'list_gl_accounts']);
  });
});
