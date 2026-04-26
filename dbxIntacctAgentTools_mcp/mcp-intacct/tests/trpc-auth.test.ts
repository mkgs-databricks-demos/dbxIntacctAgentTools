/**
 * Vitest suite for the OBO admin guard.
 *
 * Covers:
 *   - resolveIdentity reads x-forwarded-user
 *   - dev-mode fallback to MCP_DEV_USER / sentinel
 *   - admin allow-list parsing (case-insensitive, trimmed)
 *   - dev-only wildcard escape hatch
 *   - assertAdmin throws UNAUTHORIZED tRPC errors with helpful messages
 *   - adminProcedure rejects non-admins; permits admins
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';
import { TRPCError } from '@trpc/server';
import { resolveIdentity, assertAdmin } from '../server/trpc/auth.js';
import { appRouter } from '../server/trpc/router.js';
import { createTestContext } from '../server/trpc/context.js';
import type { LakebaseServices } from '../server/lakebase/index.js';

function fakeReq(headers: Record<string, string> = {}): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

function fakeLakebase(): LakebaseServices {
  return {
    registry: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      disable: vi.fn().mockResolvedValue(null),
      require: vi.fn(),
      _clearCache: vi.fn(),
    } as unknown as LakebaseServices['registry'],
    callLog: {
      record: vi.fn(),
      recent: vi.fn().mockResolvedValue([]),
    } as unknown as LakebaseServices['callLog'],
  };
}

const ENV_KEYS = ['NODE_ENV', 'INTACCT_MCP_ADMIN_USERS', 'MCP_DEV_USER'];
const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) SAVED[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe('resolveIdentity', () => {
  it('extracts userId from x-forwarded-user header', () => {
    const ident = resolveIdentity(fakeReq({ 'x-forwarded-user': 'alice@example.com' }));
    expect(ident.userId).toBe('alice@example.com');
    expect(ident.isAuthenticated).toBe(true);
  });

  it('falls back to MCP_DEV_USER in development when header is absent', () => {
    process.env.NODE_ENV = 'development';
    process.env.MCP_DEV_USER = 'dev@local';
    const ident = resolveIdentity(fakeReq());
    expect(ident.userId).toBe('dev@local');
    expect(ident.isAuthenticated).toBe(false);
  });

  it('returns null userId in production when header is absent', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MCP_DEV_USER;
    const ident = resolveIdentity(fakeReq());
    expect(ident.userId).toBeNull();
    expect(ident.isAuthenticated).toBe(false);
    expect(ident.isAdmin).toBe(false);
  });

  it('marks isAdmin=true for case-insensitive allow-list match', () => {
    process.env.INTACCT_MCP_ADMIN_USERS = 'alice@example.com, BOB@EXAMPLE.COM';
    expect(resolveIdentity(fakeReq({ 'x-forwarded-user': 'Alice@Example.com' })).isAdmin).toBe(true);
    expect(resolveIdentity(fakeReq({ 'x-forwarded-user': 'bob@example.com' })).isAdmin).toBe(true);
    expect(resolveIdentity(fakeReq({ 'x-forwarded-user': 'eve@example.com' })).isAdmin).toBe(false);
  });

  it('honors the wildcard only in development', () => {
    process.env.INTACCT_MCP_ADMIN_USERS = '*';
    process.env.NODE_ENV = 'development';
    process.env.MCP_DEV_USER = 'someone@local';
    expect(resolveIdentity(fakeReq()).isAdmin).toBe(true);

    process.env.NODE_ENV = 'production';
    expect(resolveIdentity(fakeReq({ 'x-forwarded-user': 'someone@example.com' })).isAdmin).toBe(false);
  });

  it('returns isAdmin=false when no allow-list is configured', () => {
    delete process.env.INTACCT_MCP_ADMIN_USERS;
    expect(resolveIdentity(fakeReq({ 'x-forwarded-user': 'alice@example.com' })).isAdmin).toBe(false);
  });
});

describe('assertAdmin', () => {
  it('throws UNAUTHORIZED when isAdmin=false', () => {
    expect(() =>
      assertAdmin({ userId: 'eve@example.com', isAdmin: false, isAuthenticated: true }),
    ).toThrow(TRPCError);
  });

  it('includes user id in the error message', () => {
    try {
      assertAdmin({ userId: 'eve@example.com', isAdmin: false, isAuthenticated: true });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as TRPCError).code).toBe('UNAUTHORIZED');
      expect((err as TRPCError).message).toContain('eve@example.com');
    }
  });

  it('handles a null user id with a helpful message', () => {
    try {
      assertAdmin({ userId: null, isAdmin: false, isAuthenticated: false });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as TRPCError).message).toContain('No authenticated user');
    }
  });

  it('does not throw when isAdmin=true', () => {
    expect(() =>
      assertAdmin({ userId: 'alice@example.com', isAdmin: true, isAuthenticated: true }),
    ).not.toThrow();
  });
});

describe('adminProcedure (router integration)', () => {
  it('blocks non-admins from tenants.upsert', async () => {
    const ctx = createTestContext(fakeLakebase(), {
      userId: 'eve@example.com',
      isAdmin: false,
      isAuthenticated: true,
    });
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.tenants.upsert({
        tenantId: 'acme',
        companyId: 'acmecorp',
        displayName: 'Acme Corp',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('blocks non-admins from tenants.disable', async () => {
    const ctx = createTestContext(fakeLakebase(), { userId: null, isAdmin: false, isAuthenticated: false });
    const caller = appRouter.createCaller(ctx);

    await expect(caller.tenants.disable({ tenantId: 'acme' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('permits admins to call mutations', async () => {
    const lakebase = fakeLakebase();
    const ctx = createTestContext(lakebase, {
      userId: 'alice@example.com',
      isAdmin: true,
      isAuthenticated: true,
    });
    const caller = appRouter.createCaller(ctx);

    await caller.tenants.upsert({
      tenantId: 'acme',
      companyId: 'acmecorp',
      displayName: 'Acme Corp',
    });

    expect(lakebase.registry.upsert).toHaveBeenCalledTimes(1);
  });

  it('permits non-admins to read public queries (list/get/whoami/recent)', async () => {
    const ctx = createTestContext(fakeLakebase(), {
      userId: 'eve@example.com',
      isAdmin: false,
      isAuthenticated: true,
    });
    const caller = appRouter.createCaller(ctx);

    await expect(caller.tenants.list()).resolves.toEqual([]);
    await expect(caller.tenants.get({ tenantId: 'acme' })).resolves.toBeNull();
    const ident = await caller.whoami();
    expect(ident.isAdmin).toBe(false);
    await expect(caller.mcpCallLog.recent()).resolves.toEqual([]);
  });
});
