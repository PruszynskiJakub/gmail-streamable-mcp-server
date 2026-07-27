import { Hono } from 'hono';
import { buildOAuthRoutes } from '../adapters/http-hono/routes.oauth.js';
import type { UnifiedConfig } from '../shared/config/env.js';
import type { TokenStore } from '../shared/storage/interface.js';
import { authorizationServerMetadata } from './auth.js';
import { boundedRequest } from './body.js';
import {
  corsPreflightResponse,
  requestSecurityResponse,
  withCors,
} from './security.js';

export interface AuthHttpRuntime {
  fetch(request: Request): Promise<Response>;
}

/** Standalone Bun authorization proxy (PORT + 1). */
export function buildAuthApp(
  config: UnifiedConfig,
  store: TokenStore,
  authorizationServerBaseUrl: URL,
): AuthHttpRuntime {
  const app = new Hono();
  app.get('/.well-known/oauth-authorization-server', (context) =>
    context.json(authorizationServerMetadata(config, authorizationServerBaseUrl)),
  );
  app.route('/', buildOAuthRoutes(store, config));
  app.notFound((context) => context.text('Not Found', 404));

  return {
    async fetch(request: Request): Promise<Response> {
      const rejected = requestSecurityResponse(request, config);
      if (rejected) return rejected;
      if (request.method === 'OPTIONS') {
        return corsPreflightResponse(request, ['GET', 'POST']);
      }

      const bounded = await boundedRequest(request, config.MCP_MAX_REQUEST_BYTES);
      if (bounded.rejection) return withCors(request, bounded.rejection);
      return withCors(request, await app.fetch(bounded.request));
    },
  };
}
