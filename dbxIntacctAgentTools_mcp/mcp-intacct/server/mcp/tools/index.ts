/**
 * MCP tool registry — composes all tool modules onto the McpServer.
 *
 * Each tool module exports a `register(mcp)` function that calls
 * `mcp.tool(name, schema, handler)`. Group tools by Sage Intacct domain.
 *
 * Curated tool surface (start small; grow with demand):
 *   General Ledger: list_gl_accounts, get_journal_entry, query_gl_details
 *   Accounts Receivable: list_customers, list_open_invoices, get_customer_balance
 *   Accounts Payable: list_vendors, list_bills
 *   Cash: list_payments, get_cash_position
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGeneralLedgerTools } from './general_ledger.js';
import { registerAccountsReceivableTools } from './accounts_receivable.js';

export function registerTools(mcp: McpServer): void {
  registerGeneralLedgerTools(mcp);
  registerAccountsReceivableTools(mcp);
  // registerAccountsPayableTools(mcp);
  // registerCashTools(mcp);
}
