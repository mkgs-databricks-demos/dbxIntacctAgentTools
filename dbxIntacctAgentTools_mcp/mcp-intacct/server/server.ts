/**
 * AppKit entry point for the mcp-intacct application.
 *
 * Mounts:
 *   - AppKit plugin set (server, lakebase, analytics, files)
 *   - The custom MCP server at /mcp (HTTP + SSE transports) — see ./mcp/server.ts
 *   - tRPC router for the admin/HITL UI (tenant registry, call log) — see ./api/router.ts
 *
 * Discovery: Databricks AI Playground enumerates Databricks Apps whose
 * names start with `mcp-` and treats them as custom MCP servers. The
 * Playground hits the `/mcp` HTTP/SSE endpoints exposed below.
 */

import { createApp, server, lakebase, analytics, files } from '@databricks/appkit';
import { mountMcpServer } from './mcp/server.js';

createApp({
  plugins: [
    server(),
    lakebase(),
    analytics(),
    files(),
  ],
  // Hook to wire custom Express middleware once AppKit's server is created.
  onServerReady: ({ app }) => {
    mountMcpServer(app);
  },
}).catch(console.error);
