import {
  type AuthInfo,
  buildOAuthProtectedResourceMetadata,
  type OAuthTokenVerifier,
  oauthMetadataResponse,
  type ServerNotifier,
} from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { buildOAuthRoutes } from '../adapters/http-hono/routes.oauth.js';
import { createMcpRuntime } from '../core/runtime.js';
import type { UnifiedConfig } from '../shared/config/env.js';
import type { TokenStore } from '../shared/storage/interface.js';
import { sharedLogger as logger } from '../shared/utils/logger.js';
import { createAuthServices } from './auth.js';
import { boundedRequest } from './body.js';
import {
  corsPreflightResponse,
  requestSecurityResponse,
  withCors,
} from './security.js';

export interface HttpRuntimeOptions {
  runtimeName: string;
  tokenStore: TokenStore;
  authorizationServerBaseUrl: URL;
  includeAuthorizationRoutes?: boolean;
  verifier?: OAuthTokenVerifier;
}

export interface HttpRuntime {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
  notify: ServerNotifier;
}

/** Fetch-native MCP shell shared by Bun and Cloudflare Workers. */
export function buildHttpApp(
  config: UnifiedConfig,
  options: HttpRuntimeOptions,
): HttpRuntime {
  logger.setLevel(config.LOG_LEVEL);
  const mcp = createMcpRuntime(config);
  const auth = createAuthServices(
    config,
    options.tokenStore,
    options.authorizationServerBaseUrl,
    options.verifier,
  );
  const mcpPath = config.MCP_PUBLIC_URL.pathname;
  const app = new Hono();

  app.use('*', async (context, next) => {
    const request = context.req.raw;
    const rejected = requestSecurityResponse(request, config);
    if (rejected) return rejected;

    if (auth) {
      const metadataResponse = oauthMetadataResponse(request, auth.metadata);
      if (metadataResponse) return withCors(request, metadataResponse);
    }
    await next();
    context.res = withCors(request, context.res);
  });

  app.get('/health', (context) =>
    context.json({
      status: 'ok',
      runtime: options.runtimeName,
      protocol: '2026-07-28',
      legacyMode: config.MCP_LEGACY_MODE,
      authEnabled: config.AUTH_ENABLED,
      timestamp: new Date().toISOString(),
    }),
  );

  if (auth) {
    const protectedResource = buildOAuthProtectedResourceMetadata(auth.metadata);
    for (const alias of [
      '/.well-known/oauth-protected-resource',
      `${mcpPath}/.well-known/oauth-protected-resource`,
    ]) {
      app.get(alias, (context) => context.json(protectedResource));
    }
    app.get(`${mcpPath}/.well-known/oauth-authorization-server`, (context) =>
      context.json(auth.metadata.oauthMetadata),
    );
  }

  if (options.includeAuthorizationRoutes) {
    app.route('/', buildOAuthRoutes(options.tokenStore, config));
  }

  app.options(mcpPath, (context) => corsPreflightResponse(context.req.raw, ['POST']));

  if (options.includeAuthorizationRoutes) {
    app.options('*', (context) =>
      corsPreflightResponse(context.req.raw, ['GET', 'POST']),
    );
  }

  app.all(mcpPath, async (context) => {
    const request = context.req.raw;
    let authInfo: AuthInfo | undefined;
    if (auth) {
      const authResult = await auth.gate(request);
      if (authResult instanceof Response) {
        return withCors(request, authResult);
      }
      authInfo = authResult;
    }

    const bounded = await boundedRequest(request, config.MCP_MAX_REQUEST_BYTES);
    if (bounded.rejection) return withCors(request, bounded.rejection);

    const response = await mcp.fetch(
      bounded.request,
      authInfo ? { authInfo } : undefined,
    );
    return withCors(request, response);
  });

  app.notFound((context) => context.text('Not Found', 404));

  return {
    fetch: async (request) => app.fetch(request),
    close: mcp.close,
    notify: mcp.notify,
  };
}
