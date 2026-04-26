/**
 * tRPC authentication helpers.
 *
 * Identity model:
 *   - Databricks Apps platform forwards the authenticated user's email
 *     in the `x-forwarded-user` request header.
 *   - The admin allow-list is comma-separated emails in the
 *     INTACCT_MCP_ADMIN_USERS env var (set per-target in app.yaml).
 *   - In `NODE_ENV=development`, when the header is absent, callers
 *     fall back to the `MCP_DEV_USER` env var (defaults to a sentinel).
 *     Dev callers count as admin iff they appear in the allow-list.
 *
 * Procedure hierarchy:
 *   publicProcedure  — anyone with app access can read
 *   adminProcedure   — only allow-listed users can mutate
 */

import { TRPCError } from '@trpc/server';
import type { Request } from 'express';

const ADMIN_USERS_ENV = 'INTACCT_MCP_ADMIN_USERS';
const DEV_USER_ENV = 'MCP_DEV_USER';
const DEV_USER_DEFAULT = 'dev-user@local';

/** Identity surfaced on every tRPC context. */
export interface RequestIdentity {
  /** Resolved user email or null if no identity could be established. */
  userId: string | null;
  /** Convenience flag — true iff `userId` is in the admin allow-list. */
  isAdmin: boolean;
  /** Whether the userId came from the platform header (vs dev fallback). */
  isAuthenticated: boolean;
}

/**
 * Resolve the request's identity + admin status.
 *
 * Reads:
 *   x-forwarded-user header (set by Databricks Apps in production)
 *   MCP_DEV_USER env var (fallback in NODE_ENV=development)
 *   INTACCT_MCP_ADMIN_USERS env var (admin allow-list)
 */
export function resolveIdentity(req: Request): RequestIdentity {
  const headerValue = req.header('x-forwarded-user');
  const isDev = process.env.NODE_ENV === 'development';
  const userId = headerValue ?? (isDev ? (process.env[DEV_USER_ENV] ?? DEV_USER_DEFAULT) : null);
  const isAuthenticated = Boolean(headerValue);

  return {
    userId,
    isAuthenticated,
    isAdmin: userId !== null && isInAllowList(userId),
  };
}

function isInAllowList(userId: string): boolean {
  const raw = process.env[ADMIN_USERS_ENV];
  if (!raw) {
    return false;
  }
  // Wildcard escape hatch — only honored in development.
  if (raw.trim() === '*' && process.env.NODE_ENV === 'development') {
    return true;
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => entry.toLowerCase() === userId.toLowerCase());
}

/**
 * Throw an UNAUTHORIZED tRPC error if the identity is not an admin.
 * Used by the `adminProcedure` middleware in `router.ts`.
 */
export function assertAdmin(identity: RequestIdentity): void {
  if (!identity.isAdmin) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: identity.userId
        ? `User '${identity.userId}' is not an admin of this MCP server`
        : 'No authenticated user — cannot perform admin operations',
    });
  }
}
