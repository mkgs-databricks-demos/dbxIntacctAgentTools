/**
 * MCP tools — Cash Management.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runTenantCall } from './_helpers.js';

export function registerCashTools(mcp: McpServer): void {
  mcp.registerTool(
    'list_payments',
    {
      description:
        'List Cash Management payments (incoming AR receipts or outgoing AP disbursements) ' +
        'within a date range, optionally filtered by direction or specific cash account.',
      inputSchema: {
        tenant_id: z.string(),
        direction: z.enum(['in', 'out']).optional().describe('"in" = AR receipt, "out" = AP disbursement'),
        start_date: z.string().optional().describe('Inclusive start date (YYYY-MM-DD)'),
        end_date: z.string().optional().describe('Inclusive end date (YYYY-MM-DD)'),
        account_id: z.string().optional().describe('Restrict to a single cash account'),
        max_results: z.number().int().positive().max(1000).optional().default(100),
      },
    },
    async (args) =>
      runTenantCall({ toolName: 'list_payments', toolInput: args }, (client) =>
        client.listPayments({
          direction: args.direction,
          startDate: args.start_date,
          endDate: args.end_date,
          accountId: args.account_id,
          maxResults: args.max_results,
        }),
      ),
  );

  mcp.registerTool(
    'get_cash_position',
    {
      description:
        'Cash position roll-up across all configured cash accounts as of an optional date ' +
        '(defaults to today). One row per account with end-of-day balance.',
      inputSchema: {
        tenant_id: z.string(),
        as_of_date: z.string().optional().describe('Optional ISO 8601 date — defaults to today'),
      },
    },
    async (args) =>
      runTenantCall({ toolName: 'get_cash_position', toolInput: args }, (client) =>
        client.getCashPosition({ asOfDate: args.as_of_date }),
      ),
  );
}
