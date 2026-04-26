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
            limit: z.number().int().positive().max(500).optional().default(50),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        // Direct pg query via the call log's pool to keep all DB access
        // colocated in the lakebase module.
        return ctx.lakebase.callLog.recent({
          tenantId: input?.tenantId,
          toolName: input?.toolName,
          limit: input?.limit ?? 50,
        });
      }),
  }),
});

export type AppRouter = typeof appRouter;
