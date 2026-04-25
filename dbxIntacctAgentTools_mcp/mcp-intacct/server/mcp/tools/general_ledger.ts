/**
 * MCP tools — General Ledger.
 *
 * Per-tool flow:
 *   1. Resolve a per-tenant IntacctClient (cached) via `tenant_id` arg
 *   2. Call the curated client method
 *   3. Return MCP-shaped JSON
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runTenantCall } from './_helpers.js';

export function registerGeneralLedgerTools(mcp: McpServer): void {
  mcp.registerTool(
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
    async (args) =>
      runTenantCall(args.tenant_id, (client) =>
        client.listGlAccounts({
          accountNoPrefix: args.account_no_prefix,
          modifiedSince: args.modified_since,
          maxResults: args.max_results,
        }),
      ),
  );

  mcp.registerTool(
    'get_journal_entry',
    {
      description: 'Fetch one journal entry by ID, including line items and dimensions.',
      inputSchema: {
        tenant_id: z.string(),
        journal_entry_id: z.string().describe('Sage Intacct journal entry ID'),
      },
    },
    async (args) =>
      runTenantCall(args.tenant_id, (client) => client.getJournalEntry(args.journal_entry_id)),
  );

  mcp.registerTool(
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
    async (args) =>
      runTenantCall(args.tenant_id, (client) =>
        client.queryGlDetails({
          startDate: args.start_date,
          endDate: args.end_date,
          accountNoPrefix: args.account_no_prefix,
          maxResults: args.max_results,
        }),
      ),
  );
}
