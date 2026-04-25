/**
 * Custom MCP server skeleton.
 *
 * Mounts an MCP server at `/mcp` over HTTP + SSE transports. Tools are
 * registered in `./tools/index.ts`. Per-tenant credentials are resolved
 * from the Databricks secret scope on every tool call (a fresh resolution
 * per call keeps the server stateless and supports tenant rotation).
 *
 * Build out: implement `./tools/*.ts` files for each curated MCP tool.
 * Start with read-heavy tools (list_gl_accounts, get_journal_entry,
 * list_customers, list_vendors) before adding writes.
 */

import type { Application, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerTools } from './tools/index.js';

const SSE_TRANSPORTS = new Map<string, SSEServerTransport>();

/**
 * Mount the MCP server onto the AppKit Express app.
 *
 * The parameter is `Application` (not `Express`) because AppKit's
 * `appkit.server.extend()` callback receives an `express.Application`.
 */
export function mountMcpServer(app: Application): void {
  const mcp = new McpServer(
    {
      name: 'mcp-intacct',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  registerTools(mcp);

  // SSE transport: long-lived connection for client → server messages.
  app.get('/mcp/sse', async (_req: Request, res: Response) => {
    const transport = new SSEServerTransport('/mcp/messages', res);
    SSE_TRANSPORTS.set(transport.sessionId, transport);

    res.on('close', () => {
      SSE_TRANSPORTS.delete(transport.sessionId);
    });

    await mcp.connect(transport);
  });

  // Inbound messages from the SSE client side.
  app.post('/mcp/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = SSE_TRANSPORTS.get(sessionId);
    if (!transport) {
      res.status(404).send('Unknown session');
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  // Light health check for the MCP path.
  app.get('/mcp/health', (_req, res) => {
    res.json({ status: 'ok', server: 'mcp-intacct', sessions: SSE_TRANSPORTS.size });
  });
}
