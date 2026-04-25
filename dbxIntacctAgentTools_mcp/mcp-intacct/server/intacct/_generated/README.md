# Generated Sage Intacct OpenAPI types

This directory holds OpenAPI-derived TypeScript types for the Sage Intacct REST API. It is **regenerated**, not hand-edited.

## Regenerate

```bash
# from mcp-intacct/
./scripts/regenerate_intacct_client.sh
```

The script:
1. Downloads the latest OpenAPI spec from `developer.sage.com/intacct/apis/intacct/1/intacct-openapi.yaml`
2. Pins it to `mcp-intacct/spec/intacct-openapi-<date>.yaml`
3. Runs `openapi-typescript` to produce a types-only file at `_generated/intacct-openapi.ts`

## Why types-only?

The hand-written wrapper in `server/intacct/client.ts` handles:
- Bearer-token auth + caching (`auth.ts`)
- Per-tenant credential resolution from Databricks secret scope (`credentials.ts`)
- Pagination loops (`pagination.ts`)
- Retries on 429 / 5xx
- Raw-response capture to UC Volumes

A full client generator would duplicate all of that. Types-only keeps the runtime surface tiny and lets the wrapper own the operational concerns.
