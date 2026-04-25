/**
 * MCP tools — General Ledger.
 *
 * Implementation note: each tool resolves per-tenant credentials at call
 * time, instantiates an `IntacctClient`, and translates the call. Replace
 * the stub bodies with real client calls once the TS Intacct client is
 * wired up under `server/intacct/`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerGeneralLedgerTools(mcp: McpServer): void {
  mcp.tool(
    'list_gl_accounts',
    {
      description:
        'List General Ledger accounts for the given Sage Intacct company. ' +
        'Supports optional filters on account_no prefix and modified_date.',
      inputSchema: {
        tenant_id: z.string().describe('Sage Intacct company_id (per-tenant key in the registry)'),
        account_no_prefix: z.string().optional().describe('Filter by account_no prefix (e.g. "4" for revenue accounts)'),
        modified_since: z.string().optional().describe('ISO 8601 date — only accounts modified since this timestamp'),
        max_results: z.number().int().positive().max(1000).optional().default(100),
      },
    },
    async (args) => {
      // TODO: resolve credentials, call IntacctClient.list_gl_accounts(...), return rows
      return {
        content: [
          {
            type: 'text',
            text: `Stub: list_gl_accounts(${JSON.stringify(args)}) — wire to IntacctClient`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'get_journal_entry',
    {
      description: 'Fetch one journal entry by ID, including line items and dimensions.',
      inputSchema: {
        tenant_id: z.string(),
        journal_entry_id: z.string().describe('Sage Intacct journal entry ID'),
      },
    },
    async (args) => {
      return {
        content: [{ type: 'text', text: `Stub: get_journal_entry(${JSON.stringify(args)})` }],
      };
    },
  );

  mcp.tool(
    'query_gl_details',
    {
      description:
        'Query GL transaction detail across an arbitrary date range. ' +
        'Returns lines from posted journal entries with dimension labels expanded.',
      inputSchema: {
        tenant_id: z.string(),
        start_date: z.string().describe('Inclusive start date (YYYY-MM-DD)'),
        end_date: z.string().describe('Inclusive end date (YYYY-MM-DD)'),
        account_no_prefix: z.string().optional(),
        max_results: z.number().int().positive().max(5000).optional().default(500),
      },
    },
    async (args) => {
      return {
        content: [{ type: 'text', text: `Stub: query_gl_details(${JSON.stringify(args)})` }],
      };
    },
  );
}
