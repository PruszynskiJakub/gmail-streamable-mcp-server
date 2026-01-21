/**
 * Internal MCP SDK type helpers.
 * These are used to access internal properties not exposed in the public SDK types.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Low-level server interface with internal methods.
 * The MCP SDK wraps the actual server, these are the internal methods we need.
 */
export interface LowLevelServer {
  server?: LowLevelServer;
  request?: (req: unknown, schema: unknown) => Promise<unknown>;
  notification?: (params: unknown) => Promise<void>;
  sendResourceUpdated?: (params: { uri: string; title?: string }) => void;
  sendLoggingMessage?: (params: unknown) => Promise<void>;
  setRequestHandler?: (
    method: string,
    handler: (req: unknown) => Promise<unknown>,
  ) => void;
  getClientCapabilities?: () => Record<string, unknown>;
  getClientVersion?: () => string;
  isConnected?: () => boolean;
  oninitialized?: () => void;
  _transport?: unknown;
}

/**
 * Error with optional code (JSON-RPC error).
 */
export interface RpcError extends Error {
  code?: number;
}

/**
 * Get the low-level server from an MCP server instance.
 * Handles both the wrapped and unwrapped cases.
 */
export function getLowLevelServer(server: McpServer): LowLevelServer {
  const s = server as unknown as LowLevelServer;
  return s.server ?? s;
}

/**
 * Check if an error is an RPC error with a specific code.
 */
export function isRpcError(error: unknown, code: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as RpcError).code === code
  );
}

/**
 * Type assertion for accessing server as LowLevelServer.
 */
export function asLowLevel(server: McpServer): LowLevelServer {
  return server as unknown as LowLevelServer;
}
