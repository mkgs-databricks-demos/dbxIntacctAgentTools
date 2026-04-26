/**
 * tRPC router for admin operations.
 *
 * Procedure hierarchy:
 *   publicProcedure  — anyone with app access can read
 *   adminProcedure   — only allow-listed users can mutate
 *
 * Endpoints:
 *   whoami             — current user's identity + admin flag (public)
 *   tenants.list       — list every tenant (public)
 *   tenants.get        — fetch one tenant by id (public)
 *   tenants.upsert     — insert/update a tenant (admin)
 *   tenants.disable    — soft-delete a tenant (admin)
 *   mcpCallLog.recent  — recent MCP tool invocations (public)
 */

import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import { assertAdmin } from './auth.js';
import type { TrpcContext } from './context.js';

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

const publicProcedure = t.procedure;

/** Admin-only procedure: throws UNAUTHORIZED unless ctx.identity.isAdmin. */
const adminProcedure = t.procedure.use(({ ctx, next }) => {
  assertAdmin(ctx.identity);
  return next({ ctx });
});

const tenantUpsertInput = z.object({
  tenantId: z.string().min(1).max(64),
  companyId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(256),
  userSecretKey: z.string().min(1).max(256).optional(),
  passwordSecretKey: z.string().min(1).max(256).optional(),
  enabled: z.boolean().optional(),
  writesEnabled: z.boolean().optional(),
  notes: z.string().max(2048).nullable().optional(),
});

export const appRouter = t.router({
  whoami: publicProcedure.query(({ ctx }) => ctx.identity),

  tenants: t.router({
    list: publicProcedure.query(async ({ ctx }) => {
      return ctx.lakebase.registry.list();
    }),

    get: publicProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ ctx, input }) => {
        return ctx.lakebase.registry.get(input.tenantId);
      }),

    upsert: adminProcedure.input(tenantUpsertInput).mutation(async ({ ctx, input }) => {
      return ctx.lakebase.registry.upsert(input);
    }),

    disable: adminProcedure
      .input(z.object({ tenantId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.lakebase.registry.disable(input.tenantId);
      }),
  }),

  mcpCallLog: t.router({
    recent: publicProcedure
      .input(
        z
          .object({
            tenantId: z.string().optional(),
            toolName: z.string().optional(),
            status: z.enum(['success', 'error']).optional(),
            limit: z.number().int().positive().max(500).optional().default(25),
            offset: z.number().int().min(0).optional().default(0),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        return ctx.lakebase.callLog.recent({
          tenantId: input?.tenantId,
          toolName: input?.toolName,
          status: input?.status,
          limit: input?.limit ?? 25,
          offset: input?.offset ?? 0,
        });
      }),

    /** Distinct tool names for the filter dropdown. */
    toolNames: publicProcedure.query(async ({ ctx }) => {
      return ctx.lakebase.callLog.distinctToolNames();
    }),
  }),
});

export type AppRouter = typeof appRouter;
