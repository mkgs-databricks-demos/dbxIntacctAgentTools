/**
 * MCP tool registry — composes all tool modules onto the McpServer.
 *
 * Each tool module exports a `register*Tools(mcp)` function that calls
 * `mcp.registerTool(name, config, handler)`. Group tools by Sage
 * Intacct domain.
 *
 * Curated tool surface (10 tools across 4 domains):
 *   General Ledger:        list_gl_accounts, get_journal_entry, query_gl_details
 *   Accounts Receivable:   list_customers, list_open_invoices, get_customer_balance
 *   Accounts Payable:      list_vendors, list_bills
 *   Cash Management:       list_payments, get_cash_position
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAccountsPayableTools } from './accounts_payable.js';
import { registerAccountsReceivableTools } from './accounts_receivable.js';
import { registerCashTools } from './cash.js';
import { registerGeneralLedgerTools } from './general_ledger.js';

export function registerTools(mcp: McpServer): void {
  registerGeneralLedgerTools(mcp);
  registerAccountsReceivableTools(mcp);
  registerAccountsPayableTools(mcp);
  registerCashTools(mcp);
}
