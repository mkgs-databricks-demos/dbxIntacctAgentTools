/**
 * tRPC router for admin operations.
 *
 * Endpoints:
 *   tenants.list       — list every tenant
 *   tenants.get        — fetch one tenant by id
 *   tenants.upsert     — insert/update a tenant
 *   tenants.disable    — soft-delete a tenant
 *   mcpCallLog.recent  — recent MCP tool invocations (admin audit)
 *
 * SQL SELECTs are deliberately exposed via tRPC here (rather than the
 * AppKit analytics plugin) because the data lives in Lakebase OLTP, not
 * the SQL warehouse. Analytics-plugin SQL files target the warehouse;
 * Lakebase queries go through tRPC.
 */

import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import type { TrpcContext } from './context.js';

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

const publicProcedure = t.procedure;

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
  tenants: t.router({
    list: publicProcedure.query(async ({ ctx }) => {
      return ctx.lakebase.registry.list();
    }),

    get: publicProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ ctx, input }) => {
        return ctx.lakebase.registry.get(input.tenantId);
      }),

    upsert: publicProcedure.input(tenantUpsertInput).mutation(async ({ ctx, input }) => {
      return ctx.lakebase.registry.upsert(input);
    }),

    disable: publicProcedure
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
