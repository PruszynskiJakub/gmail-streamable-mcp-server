import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import type { UnifiedConfig } from '../shared/config/env.js';
import { sharedLogger as logger } from '../shared/utils/logger.js';
import { createMcpServer } from './mcp.js';

export type McpRuntime = McpHttpHandler;

/**
 * Create one deployment-scoped fetch handler. Its SDK-owned factory creates a
 * new McpServer for every modern request and every stateless legacy request.
 */
export function createMcpRuntime(config: UnifiedConfig): McpRuntime {
  return createMcpHandler((context) => createMcpServer(config, context), {
    legacy: config.MCP_LEGACY_MODE,
    responseMode: 'auto',
    onerror(error) {
      logger.error('mcp', {
        message: 'MCP request failed',
        error: error.message,
      });
    },
  });
}
