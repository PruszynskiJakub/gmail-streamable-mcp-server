import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type { UnifiedConfig } from '../config/env.js';
import { buildProviderRefreshConfig, ensureFreshToken } from '../oauth/refresh.js';
import type { TokenStore } from '../storage/interface.js';

export const GMAIL_ACCESS_TOKEN_EXTRA_KEY = 'gmailAccessToken';

async function principalId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `rs:${hex}`;
}

/**
 * Validate the existing opaque RS-token record and expose only the current
 * Gmail access token through a deliberately named AuthInfo.extra field.
 */
export function createOpaqueTokenVerifier(
  config: UnifiedConfig,
  store: TokenStore,
): OAuthTokenVerifier {
  const providerConfig = buildProviderRefreshConfig(config);

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const existing = await store.getByRsAccess(token);
        if (!existing?.provider?.access_token) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, 'Access token is invalid');
        }

        const fresh = await ensureFreshToken(token, store, providerConfig);
        const record = await store.getByRsAccess(token);
        const gmailAccessToken = fresh.accessToken || record?.provider.access_token;
        const expiresAtMs = record?.provider.expires_at;

        if (!record || !gmailAccessToken || !expiresAtMs) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, 'Access token is invalid');
        }

        const expiresAt = Math.floor(expiresAtMs / 1_000);
        if (expiresAt <= Math.floor(Date.now() / 1_000)) {
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            'Provider authorization is expired',
          );
        }

        const recordedScopes = record.provider.scopes ?? [];
        const scopes = recordedScopes.length
          ? recordedScopes
          : config.OAUTH_SCOPES.split(/\s+/).filter(Boolean);

        return {
          token,
          clientId: await principalId(token),
          scopes: [...new Set(scopes)],
          expiresAt,
          resource: new URL(config.AUTH_RESOURCE_URI || config.MCP_PUBLIC_URL.href),
          extra: {
            [GMAIL_ACCESS_TOKEN_EXTRA_KEY]: gmailAccessToken,
          },
        };
      } catch (error) {
        if (error instanceof OAuthError) throw error;
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          'Access token could not be validated',
        );
      }
    },
  };
}

export function gmailAccessTokenFromAuthInfo(
  authInfo: AuthInfo | undefined,
): string | undefined {
  const value = authInfo?.extra?.[GMAIL_ACCESS_TOKEN_EXTRA_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
