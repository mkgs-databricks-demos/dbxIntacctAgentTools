/**
 * MCP tools — Accounts Receivable.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runTenantCall } from './_helpers.js';

export function registerAccountsReceivableTools(mcp: McpServer): void {
  mcp.tool(
    'list_customers',
    {
      description: 'List active customers for the given Sage Intacct company.',
      inputSchema: {
        tenant_id: z.string(),
        name_contains: z.string().optional(),
        max_results: z.number().int().positive().max(1000).optional().default(100),
      },
    },
    async (args) =>
      runTenantCall(args.tenant_id, (client) =>
        client.listCustomers({
          nameContains: args.name_contains,
          maxResults: args.max_results,
        }),
      ),
  );

  mcp.tool(
    'list_open_invoices',
    {
      description:
        'List open (unpaid) AR invoices, optionally filtered by customer or aging bucket.',
      inputSchema: {
        tenant_id: z.string(),
        customer_id: z.string().optional(),
        aging_bucket: z.enum(['current', '1_30', '31_60', '61_90', '90_plus']).optional(),
        max_results: z.number().int().positive().max(1000).optional().default(100),
      },
    },
    async (args) =>
      runTenantCall(args.tenant_id, (client) =>
        client.listOpenInvoices({
          customerId: args.customer_id,
          agingBucket: args.aging_bucket,
          maxResults: args.max_results,
        }),
      ),
  );

  mcp.tool(
    'get_customer_balance',
    {
      description: 'Get the open AR balance for a single customer, broken out by aging bucket.',
      inputSchema: {
        tenant_id: z.string(),
        customer_id: z.string(),
      },
    },
    async (args) =>
      runTenantCall(args.tenant_id, (client) => client.getCustomerBalance(args.customer_id)),
  );
}
