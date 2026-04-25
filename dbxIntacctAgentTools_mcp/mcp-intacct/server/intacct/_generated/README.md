# Generated Sage Intacct OpenAPI types (TypeScript)

This directory is the destination for OpenAPI-derived TypeScript types for the Sage Intacct REST API. The generated file is regenerated, not hand-edited.

## Current status

**The auto-regen script does not work end-to-end at the moment.** Sage's developer portal (`developer.sage.com`) is fronted by Cloudflare and returns HTTP 403 to every automated request — the regen script's `curl`, plain `curl`, custom-User-Agent `curl`, and Claude's `WebFetch` were all blocked.

What's already in place:
- `mcp-intacct/scripts/regenerate_intacct_client.sh` — the regen script. Has a `--spec <path>` flag for use with a manually-downloaded local copy.
- `openapi-typescript@^7.4.0` — installed as a devDependency in `package.json`.
- `_generated/` directory + `.gitignore` rule that ignores `intacct-openapi.ts` (so the generated file is never committed) but preserves this README and the `.gitkeep`.

What's missing:
- An actual TypeScript types file. As a result, `server/intacct/client.ts` methods currently return `Record<string, unknown>` — the runtime works, but you get no compile-time field safety on Sage payloads.

## Two paths to typed signatures

You have two ways to close this gap. Pick whichever fits your moment.

---

### Option A — Hand-craft a focused `types.ts`

Best when you want to make progress without depending on Sage's portal availability. Tightest scope: just the fields the curated client methods actually return.

**Step 1: Create `server/intacct/types.ts`** with TypeScript interfaces for each return shape:

```ts
// server/intacct/types.ts

/** Sage Intacct GL account (subset — extend as new fields are needed). */
export interface GLAccount {
  id: string;
  account_no: string;
  account_label: string;
  category?: string;
  status?: 'active' | 'inactive';
  modified_at?: string;
  audit_trail?: { created_at?: string; modified_at?: string };
}

/** Single line on a posted journal entry. */
export interface JournalEntryLine {
  id: string;
  account_no: string;
  amount: number;
  debit_credit: 'debit' | 'credit';
  memo?: string;
  dimensions?: Record<string, string>;
}

/** Posted journal entry header + lines. */
export interface JournalEntry {
  id: string;
  batch_no?: string;
  posting_date: string;
  description?: string;
  lines: JournalEntryLine[];
}

/** Single GL transaction detail line (read-only). */
export interface GLDetailLine {
  id: string;
  account_no: string;
  posting_date: string;
  amount: number;
  source_doc?: string;
  description?: string;
  dimensions?: Record<string, string>;
}

/** Customer in Accounts Receivable. */
export interface Customer {
  id: string;
  customer_no?: string;
  name: string;
  status?: 'active' | 'inactive';
  primary_contact?: { name?: string; email?: string };
}

/** AR invoice (subset). */
export interface Invoice {
  id: string;
  invoice_no: string;
  customer_id: string;
  state: 'open' | 'partially_paid' | 'paid' | 'voided';
  posting_date: string;
  due_date: string;
  total_amount: number;
  amount_due: number;
  aging_bucket?: 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
}

/** Customer balance roll-up by aging bucket. */
export interface CustomerBalance {
  customer_id: string;
  total_open: number;
  buckets: {
    current: number;
    '1_30': number;
    '31_60': number;
    '61_90': number;
    '90_plus': number;
  };
}
```

**Step 2: Type the client method signatures** in `server/intacct/client.ts`:

```ts
import type {
  Customer, CustomerBalance, GLAccount, GLDetailLine,
  Invoice, JournalEntry,
} from './types.js';

async listGlAccounts(filters: ...): Promise<GLAccount[]> {
  // existing collect(this.list(...)) returns Record<string, unknown>[];
  // cast at the boundary:
  return collect<GLAccount>(this.list<GLAccount>('objects/general-ledger/account', { params, maxResults: filters.maxResults }), filters.maxResults);
}

async getJournalEntry(id: string): Promise<JournalEntry> {
  return this.request<JournalEntry>('GET', `objects/general-ledger/journal-entry/${id}`);
}

async queryGlDetails(args: ...): Promise<GLDetailLine[]> { ... }
async listCustomers(filters: ...): Promise<Customer[]> { ... }
async listOpenInvoices(filters: ...): Promise<Invoice[]> { ... }
async getCustomerBalance(customerId: string): Promise<CustomerBalance> { ... }
```

**Step 3: Tighten `outputSchema` on the 6 MCP tools.** In `server/mcp/tools/general_ledger.ts` and `accounts_receivable.ts`, switch each `mcp.registerTool(name, { inputSchema })` to also declare an `outputSchema` so AI Playground and other MCP clients see richer types:

```ts
import { z } from 'zod';

const glAccountSchema = z.object({
  id: z.string(),
  account_no: z.string(),
  account_label: z.string(),
  category: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  modified_at: z.string().optional(),
});

mcp.registerTool('list_gl_accounts', {
  description: '...',
  inputSchema: { /* unchanged */ },
  outputSchema: { accounts: z.array(glAccountSchema) },
}, async (args) => { /* unchanged */ });
```

(Note: `outputSchema` requires you to return an object whose top-level keys match the schema — adjust the `runTenantCall` content shape if needed.)

**Step 4: Add tests.** Extend `tests/intacct-client.test.ts` (create if missing) to assert the typed shape comes through:

```ts
const accounts = await client.listGlAccounts({});
expect(accounts[0]?.account_no).toBeDefined(); // compile error if listGlAccounts is still Record<string, unknown>
```

**Step 5: Verify.**

```bash
cd dbxIntacctAgentTools_mcp/mcp-intacct
npm run typecheck
npm run lint
npx vitest run
```

**Step 6: Update `NEXT_STEPS.md` §1.1** to mark this approach as done; auto-gen (Option B) becomes the follow-up.

---

### Option B — Manual spec download + auto-regen

Best when you want full surface coverage and are OK doing one manual download per release. The TypeScript regen script + types-only generator handles the rest.

**Step 1: Download the spec from a browser.**

1. In a normal browser session (Safari, Chrome, Firefox, Arc), navigate to:
   - https://developer.sage.com/intacct/apis/intacct/1/intacct-openapi
2. Look for "Download" / "Export" / "Raw" controls in the API explorer UI. Sage's portal exposes the YAML behind `https://developer.sage.com/intacct/apis/intacct/1/intacct-openapi.yaml` and the JSON behind `.json`. (The Cloudflare bot wall is what blocks scripted access; a real browser session is fine.)
3. Save the file as **YAML** to your local machine. JSON works too — `openapi-typescript` accepts both — but YAML is more readable in diffs.

**Step 2: Place the spec in the repo at the conventional path.**

```bash
# from the repo root
mkdir -p dbxIntacctAgentTools_mcp/mcp-intacct/spec
mv ~/Downloads/intacct-openapi.yaml \
   dbxIntacctAgentTools_mcp/mcp-intacct/spec/intacct-openapi-$(date +%Y%m%d).yaml
```

The directory `mcp-intacct/spec/` is in `.gitignore`. **Do not** commit the spec to the repo (Sage's content license + size). Each engineer downloads their own copy.

**Step 3: Generate the TypeScript types from the local spec.**

```bash
cd dbxIntacctAgentTools_mcp/mcp-intacct
./scripts/regenerate_intacct_client.sh --spec spec/intacct-openapi-$(date +%Y%m%d).yaml
```

The script writes `server/intacct/_generated/intacct-openapi.ts` (gitignored). Expect a single file in the 100k–500k line range covering every Sage REST object.

**Step 4: Reference the generated types in `server/intacct/client.ts`.**

The generated file exports paths and components under namespaces. Example:

```ts
import type { components, paths } from './_generated/intacct-openapi.js';

type GLAccount = components['schemas']['GLAccount'];
type JournalEntry = components['schemas']['JournalEntry'];

async listGlAccounts(...): Promise<GLAccount[]> { ... }
async getJournalEntry(id: string): Promise<JournalEntry> { ... }
```

The exact schema names depend on what Sage publishes — open `_generated/intacct-openapi.ts` and search for `GLAccount` / `JournalEntry` / `Customer` / etc. to find the canonical names.

**Step 5: Verify.**

```bash
npm run typecheck
npm run lint
npx vitest run
```

**Step 6: Update `NEXT_STEPS.md` §1.1** to "done" and note the spec date you regenerated against, so the next person knows when to refresh.

**Step 7 (optional): Bump CI.** If you set up CI from `NEXT_STEPS.md §4.3`, gate it on the generated file existing — engineers without a local spec will need a CI artifact or a committed spec. Consider committing **only the generated file** (not the spec) so CI doesn't need to download.

---

## Why types-only (and not a full client)?

The hand-written wrapper in `server/intacct/client.ts` already handles:
- Bearer-token auth + caching (`auth.ts`)
- Per-tenant credential resolution from the Databricks secret scope (`credentials.ts`)
- Pagination loops (`pagination.ts`)
- Retries on 429 / 5xx
- Raw-response capture to UC Volumes (`raw_response_writer.ts`)

A full client generator would duplicate every one of those concerns. Types-only keeps the runtime surface tiny and lets the wrapper own operational concerns.

## See also

- [Python equivalent](../../../../dbxIntacctAgentTools_sdk/src/intacct_sdk/_generated/README.md) — same regen story for `intacct_sdk`.
- [`NEXT_STEPS.md` §1.1](../../../../../NEXT_STEPS.md) — current status of typed signatures across both SDKs.
