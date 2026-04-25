/**
 * AppKit entry point for the mcp-intacct application.
 *
 * Mounts:
 *   - AppKit plugin set (server, lakebase, analytics, files)
 *   - The custom MCP server at /mcp (HTTP + SSE transports) — see ./mcp/server.ts
 *
 * Discovery: Databricks AI Playground enumerates Databricks Apps whose
 * names start with `mcp-` and treats them as custom MCP servers. The
 * Playground hits the `/mcp/sse` and `/mcp/messages` endpoints below.
 *
 * Pattern: we instantiate AppKit with `server({ autoStart: false })` so
 * we can call `appkit.server.extend()` to mount our custom Express
 * middleware before starting the listener. Without this, the server
 * starts before our routes register and Playground sees 404s.
 */

import { createApp, server, lakebase, analytics, files } from '@databricks/appkit';
import { mountMcpServer } from './mcp/server.js';

const appkit = await createApp({
  plugins: [server({ autoStart: false }), lakebase(), analytics(), files()],
});

appkit.server.extend((app) => {
  mountMcpServer(app);
});

await appkit.server.start();
