import type {
  AuthInfo,
  McpServer,
  ServerContext,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { gmailAccessTokenFromAuthInfo } from '../shared/auth/opaque-token-verifier.js';
import type { UnifiedConfig } from '../shared/config/env.js';
import { sharedTools } from '../shared/tools/registry.js';
import type { ToolContext } from '../shared/tools/types.js';
import { sharedLogger as logger } from '../shared/utils/logger.js';

function safeAuthInfo(
  authInfo: AuthInfo | undefined,
): ToolContext['authInfo'] | undefined {
  if (!authInfo) return undefined;
  return {
    clientId: authInfo.clientId,
    scopes: [...authInfo.scopes],
    expiresAt: authInfo.expiresAt,
    resource: authInfo.resource,
  };
}

function staticProviderToken(config: UnifiedConfig): string | undefined {
  if (config.AUTH_STRATEGY === 'bearer') return config.BEARER_TOKEN;
  if (config.AUTH_STRATEGY === 'api_key') return config.API_KEY;
  return undefined;
}

function toolContext(config: UnifiedConfig, context: ServerContext): ToolContext {
  const authInfo = context.http?.authInfo;
  return {
    signal: context.mcpReq.signal,
    meta: {
      progressToken: context.mcpReq._meta?.progressToken,
      requestId: String(context.mcpReq.id),
    },
    authStrategy: config.AUTH_STRATEGY,
    providerToken:
      config.AUTH_STRATEGY === 'oauth'
        ? gmailAccessTokenFromAuthInfo(authInfo)
        : staticProviderToken(config),
    authInfo: safeAuthInfo(authInfo),
  };
}

type PublicTool = (typeof sharedTools)[number];
type ObjectSchema = StandardSchemaWithJSON<
  Record<string, unknown>,
  Record<string, unknown>
>;

function registerPublicTool(
  server: McpServer,
  config: UnifiedConfig,
  tool: PublicTool,
): void {
  const inputSchema = tool.inputSchema as ObjectSchema;
  const outputSchema = tool.outputSchema as ObjectSchema;

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema,
      outputSchema,
      annotations: tool.annotations,
    },
    async (args, context) => tool.handler(args as never, toolContext(config, context)),
  );
}

/** Register the preserved Gmail tool surface in deterministic order. */
export function registerTools(server: McpServer, config: UnifiedConfig): void {
  for (const tool of sharedTools) {
    registerPublicTool(server, config, tool);
  }

  logger.info('tools', {
    message: `Registered ${sharedTools.length} Gmail tools`,
    toolNames: sharedTools.map((tool) => tool.name),
  });
}
