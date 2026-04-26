/**
 * MCP tools — write-path operations.
 *
 * Each tool calls `runTenantCall` with `requireWrites: true`, which
 * checks the registry's `writes_enabled` flag before resolving the
 * tenant client. Tenants with writes_enabled=false get a clean
 * "writes_enabled=false" error before any Sage REST call is attempted.
 *
 * Writes accept an optional `idempotency_key` argument — forwarded as
 * the `Idempotency-Key` HTTP header so an agent retrying after a
 * timeout / 5xx doesn't double-post.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runTenantCall } from './_helpers.js';

const idempotencyKeyDoc = 'Optional client-supplied idempotency key. Forwarded as the Idempotency-Key HTTP header.';

export function registerWriteTools(mcp: McpServer): void {
  mcp.registerTool(
    'post_journal_entry',
    {
      description:
        'Post a journal entry to Sage Intacct. Requires the tenant to have ' +
        'writes_enabled=true in the tenant registry.',
      inputSchema: {
        tenant_id: z.string(),
        posting_date: z.string().describe('Inclusive posting date (YYYY-MM-DD)'),
        description: z.string().optional(),
        lines: z
          .array(
            z.object({
              account_no: z.string(),
              amount: z.number(),
              debit_credit: z.enum(['debit', 'credit']),
              memo: z.string().optional(),
              dimensions: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
            }),
          )
          .min(1, 'A journal entry must have at least one line'),
        idempotency_key: z.string().optional().describe(idempotencyKeyDoc),
      },
    },
    async (args) =>
      runTenantCall(
        { toolName: 'post_journal_entry', toolInput: args, requireWrites: true },
        (client) =>
          client.postJournalEntry(
            {
              posting_date: args.posting_date,
              description: args.description,
              lines: args.lines,
            },
            { idempotencyKey: args.idempotency_key },
          ),
      ),
  );

  mcp.registerTool(
    'record_adjustment',
    {
      description:
        'Record an AR adjustment against a specific charge line. ' +
        'Requires the tenant to have writes_enabled=true.',
      inputSchema: {
        tenant_id: z.string(),
        charge_line_id: z.string(),
        adjustment_date: z.string().describe('Inclusive date (YYYY-MM-DD)'),
        adjustment_type: z.string().describe('Adjustment type code (e.g. "WRITE_OFF", "DISCOUNT")'),
        adjustment_reason_code: z.string().optional(),
        amount: z.number(),
        memo: z.string().optional(),
        idempotency_key: z.string().optional().describe(idempotencyKeyDoc),
      },
    },
    async (args) =>
      runTenantCall(
        { toolName: 'record_adjustment', toolInput: args, requireWrites: true },
        (client) =>
          client.recordAdjustment(
            {
              charge_line_id: args.charge_line_id,
              adjustment_date: args.adjustment_date,
              adjustment_type: args.adjustment_type,
              adjustment_reason_code: args.adjustment_reason_code,
              amount: args.amount,
              memo: args.memo,
            },
            { idempotencyKey: args.idempotency_key },
          ),
      ),
  );

  mcp.registerTool(
    'apply_payment',
    {
      description:
        'Apply a payment to one or more open AR invoices. Each application ' +
        'specifies an invoice_id and amount. Sum of applications must equal ' +
        'the total amount. Requires the tenant to have writes_enabled=true.',
      inputSchema: {
        tenant_id: z.string(),
        payer_id: z.string().describe('Customer ID receiving credit for the payment'),
        payment_date: z.string().describe('Inclusive date (YYYY-MM-DD)'),
        payment_method: z.string().describe('"check", "ach", "wire", etc.'),
        account_id: z.string().describe('Cash account to deposit into'),
        amount: z.number(),
        applications: z
          .array(
            z.object({
              invoice_id: z.string(),
              amount: z.number(),
            }),
          )
          .min(1, 'A payment must apply to at least one invoice'),
        memo: z.string().optional(),
        idempotency_key: z.string().optional().describe(idempotencyKeyDoc),
      },
    },
    async (args) =>
      runTenantCall(
        { toolName: 'apply_payment', toolInput: args, requireWrites: true },
        (client) =>
          client.applyPayment(
            {
              payer_id: args.payer_id,
              payment_date: args.payment_date,
              payment_method: args.payment_method,
              account_id: args.account_id,
              amount: args.amount,
              applications: args.applications,
              memo: args.memo,
            },
            { idempotencyKey: args.idempotency_key },
          ),
      ),
  );
}
