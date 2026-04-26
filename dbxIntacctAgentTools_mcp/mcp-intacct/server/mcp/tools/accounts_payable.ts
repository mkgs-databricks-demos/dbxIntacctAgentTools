/**
 * MCP tools — Accounts Payable.
 *
 * Mirrors the GL/AR tool shape — runTenantCall validates the tenant
 * against the registry, persists a call-log row, and the handler
 * closes over the curated client method.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runTenantCall } from './_helpers.js';

export function registerAccountsPayableTools(mcp: McpServer): void {
  mcp.registerTool(
    'list_vendors',
    {
      description:
        'List vendors registered in the given Sage Intacct company. Optional filters on name and status.',
      inputSchema: {
        tenant_id: z.string().describe('Sage Intacct tenant_id (registered in tenant_registry)'),
        name_contains: z.string().optional(),
        status: z.enum(['active', 'inactive']).optional(),
        max_results: z.number().int().positive().max(1000).optional().default(100),
      },
    },
    async (args) =>
      runTenantCall({ toolName: 'list_vendors', toolInput: args }, (client) =>
        client.listVendors({
          nameContains: args.name_contains,
          status: args.status,
          maxResults: args.max_results,
        }),
      ),
  );

  mcp.registerTool(
    'list_bills',
    {
      description:
        'List AP bills filtered by vendor, payment state, or posting-date floor. ' +
        'Useful for outstanding-payable analysis and cash-flow forecasting.',
      inputSchema: {
        tenant_id: z.string(),
        vendor_id: z.string().optional(),
        state: z.enum(['open', 'partially_paid', 'paid']).optional(),
        posted_since: z.string().optional().describe('ISO 8601 date — only bills posted on/after this date'),
        max_results: z.number().int().positive().max(1000).optional().default(100),
      },
    },
    async (args) =>
      runTenantCall({ toolName: 'list_bills', toolInput: args }, (client) =>
        client.listBills({
          vendorId: args.vendor_id,
          state: args.state,
          postedSince: args.posted_since,
          maxResults: args.max_results,
        }),
      ),
  );
}
