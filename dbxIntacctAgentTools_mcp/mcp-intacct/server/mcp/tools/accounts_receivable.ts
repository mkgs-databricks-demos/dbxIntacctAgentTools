/**
 * MCP tools — Accounts Receivable.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
    async (args) => {
      return {
        content: [{ type: 'text', text: `Stub: list_customers(${JSON.stringify(args)})` }],
      };
    },
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
    async (args) => {
      return {
        content: [{ type: 'text', text: `Stub: list_open_invoices(${JSON.stringify(args)})` }],
      };
    },
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
    async (args) => {
      return {
        content: [{ type: 'text', text: `Stub: get_customer_balance(${JSON.stringify(args)})` }],
      };
    },
  );
}
