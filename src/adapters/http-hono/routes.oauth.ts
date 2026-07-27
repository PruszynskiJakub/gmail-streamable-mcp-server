import { Hono } from 'hono';
import { boundedRequest } from '../../http/body.js';
import type { UnifiedConfig } from '../../shared/config/env.js';
import { handleRegister, handleRevoke } from '../../shared/oauth/endpoints.js';
import {
  handleAuthorize,
  handleProviderCallback,
  handleToken,
} from '../../shared/oauth/flow.js';
import {
  buildFlowOptions,
  buildOAuthConfig,
  buildProviderConfig,
  buildTokenInput,
  parseAuthorizeInput,
  parseCallbackInput,
  parseTokenInput,
} from '../../shared/oauth/input-parsers.js';
import type { TokenStore } from '../../shared/storage/interface.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';

export function buildOAuthRoutes(store: TokenStore, config: UnifiedConfig): Hono {
  const app = new Hono();
  const providerConfig = buildProviderConfig(config);
  const oauthConfig = buildOAuthConfig(config);

  app.get('/authorize', async (context) => {
    try {
      const url = new URL(context.req.url);
      const result = await handleAuthorize(
        parseAuthorizeInput(url),
        store,
        providerConfig,
        oauthConfig,
        {
          ...buildFlowOptions(url, config),
          cimd: {
            enabled: config.CIMD_ENABLED,
            timeoutMs: config.CIMD_FETCH_TIMEOUT_MS,
            maxBytes: config.CIMD_MAX_RESPONSE_BYTES,
            allowedDomains: config.CIMD_ALLOWED_DOMAINS,
          },
        },
      );
      return context.redirect(result.redirectTo, 302);
    } catch (error) {
      logger.error('oauth', {
        message: 'Authorization failed',
        error: (error as Error).message,
      });
      return context.text((error as Error).message || 'Authorization failed', 400);
    }
  });

  app.get('/oauth/callback', async (context) => {
    try {
      const url = new URL(context.req.url);
      const { code, state } = parseCallbackInput(url);
      if (!code || !state) {
        return context.text('invalid_callback: missing code or state', 400);
      }
      const result = await handleProviderCallback(
        { providerCode: code, compositeState: state },
        store,
        providerConfig,
        oauthConfig,
        buildFlowOptions(url, config),
      );
      return context.redirect(result.redirectTo, 302);
    } catch (error) {
      logger.error('oauth', {
        message: 'Provider callback failed',
        error: (error as Error).message,
      });
      return context.text((error as Error).message || 'Callback failed', 500);
    }
  });

  app.post('/token', async (context) => {
    try {
      const bounded = await boundedRequest(
        context.req.raw,
        config.MCP_MAX_REQUEST_BYTES,
      );
      if (bounded.rejection) return bounded.rejection;
      const tokenInput = buildTokenInput(await parseTokenInput(bounded.request));
      if ('error' in tokenInput) {
        return context.json({ error: tokenInput.error }, 400);
      }
      return context.json(await handleToken(tokenInput, store, providerConfig));
    } catch (error) {
      logger.error('oauth', {
        message: 'Token exchange failed',
        error: (error as Error).message,
      });
      return context.json({ error: (error as Error).message || 'invalid_grant' }, 400);
    }
  });

  app.post('/revoke', async (context) => context.json(await handleRevoke()));

  app.post('/register', async (context) => {
    try {
      const bounded = await boundedRequest(
        context.req.raw,
        config.MCP_MAX_REQUEST_BYTES,
      );
      if (bounded.rejection) return bounded.rejection;
      const body = (await bounded.request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const result = await handleRegister(
        {
          redirect_uris: Array.isArray(body.redirect_uris)
            ? body.redirect_uris.filter(
                (value): value is string => typeof value === 'string',
              )
            : undefined,
          grant_types: Array.isArray(body.grant_types)
            ? body.grant_types.filter(
                (value): value is string => typeof value === 'string',
              )
            : undefined,
          response_types: Array.isArray(body.response_types)
            ? body.response_types.filter(
                (value): value is string => typeof value === 'string',
              )
            : undefined,
          client_name:
            typeof body.client_name === 'string' ? body.client_name : undefined,
        },
        new URL(context.req.url).origin,
        config.OAUTH_REDIRECT_URI,
      );
      return context.json(result, 201);
    } catch (error) {
      return context.json({ error: (error as Error).message }, 400);
    }
  });

  return app;
}
