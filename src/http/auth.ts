import {
  type AuthInfo,
  type AuthMetadataOptions,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  type OAuthTokenVerifier,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { createOpaqueTokenVerifier } from '../shared/auth/opaque-token-verifier.js';
import type { UnifiedConfig } from '../shared/config/env.js';
import { buildAuthorizationServerMetadata } from '../shared/oauth/discovery.js';
import type { TokenStore } from '../shared/storage/interface.js';

export interface AuthServices {
  gate: (request: Request) => Promise<AuthInfo | Response>;
  metadata: AuthMetadataOptions;
}

export function authorizationServerMetadata(
  config: UnifiedConfig,
  authorizationServerBaseUrl: URL,
) {
  const baseUrl = authorizationServerBaseUrl.href.replace(/\/$/, '');
  return buildAuthorizationServerMetadata(
    baseUrl,
    config.OAUTH_SCOPES.split(/\s+/).filter(Boolean),
    {
      authorizationEndpoint: `${baseUrl}/authorize`,
      tokenEndpoint: `${baseUrl}/token`,
      revocationEndpoint: `${baseUrl}/revoke`,
      cimdEnabled: config.CIMD_ENABLED,
    },
  );
}

export function createAuthServices(
  config: UnifiedConfig,
  store: TokenStore,
  authorizationServerBaseUrl: URL,
  verifier?: OAuthTokenVerifier,
): AuthServices | undefined {
  if (!config.AUTH_ENABLED || config.AUTH_STRATEGY !== 'oauth') return undefined;

  const metadata: AuthMetadataOptions = {
    oauthMetadata: authorizationServerMetadata(config, authorizationServerBaseUrl),
    resourceServerUrl: config.MCP_PUBLIC_URL,
    scopesSupported: config.AUTH_REQUIRED_SCOPES,
    resourceName: config.MCP_TITLE,
    ...(config.MCP_WEBSITE_URL
      ? { serviceDocumentationUrl: config.MCP_WEBSITE_URL }
      : {}),
    dangerouslyAllowInsecureIssuerUrl: config.NODE_ENV !== 'production',
  };

  buildOAuthProtectedResourceMetadata(metadata);
  return {
    metadata,
    gate: requireBearerAuth({
      verifier: verifier ?? createOpaqueTokenVerifier(config, store),
      requiredScopes: config.AUTH_REQUIRED_SCOPES,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.MCP_PUBLIC_URL),
    }),
  };
}

function discoveryIssuer(config: UnifiedConfig): URL | undefined {
  if (!config.AUTH_DISCOVERY_URL) return undefined;
  const url = new URL(config.AUTH_DISCOVERY_URL);
  if (url.pathname.endsWith('/.well-known/oauth-authorization-server')) {
    url.pathname = url.pathname.slice(
      0,
      -'/.well-known/oauth-authorization-server'.length,
    );
  }
  url.search = '';
  url.hash = '';
  return url;
}

export function authorizationServerBaseUrl(config: UnifiedConfig, fallback: URL): URL {
  return config.OAUTH_PROXY_PUBLIC_URL ?? discoveryIssuer(config) ?? fallback;
}

export function bunAuthorizationServerBaseUrl(config: UnifiedConfig): URL {
  const fallback = new URL(config.MCP_PUBLIC_URL.origin);
  fallback.port = String(config.PORT + 1);
  return authorizationServerBaseUrl(config, fallback);
}
