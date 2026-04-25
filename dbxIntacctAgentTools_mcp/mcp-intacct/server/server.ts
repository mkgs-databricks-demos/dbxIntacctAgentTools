/**
 * AppKit entry point for the mcp-intacct application.
 *
 * Mounts:
 *   - AppKit plugin set (server, lakebase, analytics, files)
 *   - Lakebase services (tenant registry + MCP call log)
 *   - The custom MCP server at /mcp (HTTP + SSE transports)
 *
 * Discovery: Databricks AI Playground enumerates Databricks Apps whose
 * names start with `mcp-` and treats them as custom MCP servers.
 *
 * Startup order matters: `bindLakebase()` and `initSchema()` must run
 * BEFORE `appkit.server.start()` so the first request finds the
 * registry initialized. We use `server({ autoStart: false })` and call
 * `start()` explicitly after wiring.
 */

import { createApp, server, lakebase, analytics, files } from '@databricks/appkit';
import { bindRawResponseWriter } from './intacct/raw_response_writer.js';
import { bindLakebase, initSchema } from './lakebase/index.js';
import { mountMcpServer } from './mcp/server.js';
import { mountTrpc } from './trpc/mount.js';

const appkit = await createApp({
  plugins: [server({ autoStart: false }), lakebase(), analytics(), files()],
});

// Initialize Lakebase schema (idempotent) before binding services.
await initSchema(appkit.lakebase.pool);
bindLakebase(appkit.lakebase.pool);

// Bind the raw-response capture writer onto the `files` volume so every
// Sage REST round-trip lands as JSON in the raw_responses UC Volume.
bindRawResponseWriter(appkit.files('files'));

appkit.server.extend((app) => {
  mountMcpServer(app);
  mountTrpc(app);
});

await appkit.server.start();
