import {
  type McpRequestContext,
  McpServer,
  type ServerCapabilities,
} from '@modelcontextprotocol/server';
import type { UnifiedConfig } from '../shared/config/env.js';
import { registerTools } from '../tools/index.js';

function capabilitiesFor(context: McpRequestContext): ServerCapabilities {
  return {
    logging: {},
    tools: { listChanged: context.era === 'modern' },
  };
}

/** Build a fresh Gmail MCP server for exactly one HTTP request. */
export function createMcpServer(
  config: UnifiedConfig,
  context: McpRequestContext,
): McpServer {
  const server = new McpServer(
    {
      name: config.MCP_NAME,
      title: config.MCP_TITLE,
      version: config.MCP_VERSION,
      description: config.MCP_DESCRIPTION,
      ...(config.MCP_WEBSITE_URL ? { websiteUrl: config.MCP_WEBSITE_URL.href } : {}),
    },
    {
      instructions: config.MCP_INSTRUCTIONS,
      capabilities: capabilitiesFor(context),
      cacheHints: {
        'server/discover': { ttlMs: 60_000, cacheScope: 'private' },
        'tools/list': { ttlMs: 60_000, cacheScope: 'private' },
      },
    },
  );

  registerTools(server, config);
  return server;
}
