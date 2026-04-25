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
}> = {}): LakebaseServices {
  return {
    registry: {
      list: overrides.list ?? vi.fn().mockResolvedValue([]),
      get: overrides.get ?? vi.fn().mockResolvedValue(null),
      upsert: overrides.upsert ?? vi.fn().mockResolvedValue(null),
      disable: overrides.disable ?? vi.fn().mockResolvedValue(null),
      require: vi.fn(),
      _clearCache: vi.fn(),
    } as unknown as LakebaseServices['registry'],
    callLog: {
      record: vi.fn(),
      recent: overrides.recent ?? vi.fn().mockResolvedValue([]),
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
    const caller = appRouter.createCaller(createTestContext(lakebase));

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
    const caller = appRouter.createCaller(createTestContext(lakebase));

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
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await caller.tenants.disable({ tenantId: 'acme' });

    expect(disable).toHaveBeenCalledWith('acme');
  });
});

describe('tRPC mcpCallLog.recent', () => {
  it('forwards filters with defaults', async () => {
    const recent = vi.fn().mockResolvedValue([]);
    const lakebase = fakeLakebase({ recent });
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await caller.mcpCallLog.recent();

    expect(recent).toHaveBeenCalledWith({
      tenantId: undefined,
      toolName: undefined,
      limit: 50,
    });
  });

  it('forwards tenant + tool filters', async () => {
    const recent = vi.fn().mockResolvedValue([]);
    const lakebase = fakeLakebase({ recent });
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await caller.mcpCallLog.recent({
      tenantId: 'acme',
      toolName: 'list_gl_accounts',
      limit: 10,
    });

    expect(recent).toHaveBeenCalledWith({
      tenantId: 'acme',
      toolName: 'list_gl_accounts',
      limit: 10,
    });
  });

  it('caps limit at 500 via zod validation', async () => {
    const lakebase = fakeLakebase();
    const caller = appRouter.createCaller(createTestContext(lakebase));

    await expect(caller.mcpCallLog.recent({ limit: 5_000 })).rejects.toThrow();
  });
});
