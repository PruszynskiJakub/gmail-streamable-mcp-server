import { afterEach, describe, expect, test } from 'bun:test';
import { buildAuthApp } from '../src/http/auth-app.js';
import { parseConfig } from '../src/shared/config/env.js';
import { MemoryTokenStore } from '../src/shared/storage/memory.js';

const originalFetch = globalThis.fetch;
const stores = new Set<MemoryTokenStore>();

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const store of stores) store.stopCleanup();
  stores.clear();
});

function oauthConfig() {
  return parseConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    MCP_PUBLIC_URL: 'http://localhost:3000/mcp',
    MCP_ALLOWED_HOSTS: 'localhost',
    MCP_ALLOWED_ORIGIN_HOSTNAMES: 'localhost,client.example',
    AUTH_ENABLED: 'true',
    AUTH_STRATEGY: 'oauth',
    PROVIDER_CLIENT_ID: 'google-client',
    PROVIDER_CLIENT_SECRET: 'google-secret',
    PROVIDER_ACCOUNTS_URL: 'https://accounts.google.com',
    OAUTH_AUTHORIZATION_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
    OAUTH_TOKEN_URL: 'https://oauth2.googleapis.com/token',
    OAUTH_REVOCATION_URL: 'https://oauth2.googleapis.com/revoke',
    OAUTH_SCOPES: 'gmail.readonly gmail.compose gmail.modify',
    OAUTH_REDIRECT_URI: 'http://localhost:3001/oauth/callback',
    OAUTH_REDIRECT_ALLOWLIST:
      'http://client.example/callback,http://localhost:3001/oauth/callback',
    OAUTH_EXTRA_AUTH_PARAMS: 'access_type=offline&prompt=consent',
    CIMD_ENABLED: 'true',
    CIMD_ALLOWED_DOMAINS: 'client.example',
  });
}

function authRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set('Host', 'localhost:3001');
  return new Request(`http://localhost:3001${path}`, { ...init, headers });
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return Buffer.from(digest).toString('base64url');
}

describe('CIMD + PKCE authorization proxy', () => {
  test('applies strict Origin/CORS and bounds OAuth POST bodies before parsing', async () => {
    const config = oauthConfig();
    config.MCP_MAX_REQUEST_BYTES = 1024;
    const store = new MemoryTokenStore();
    stores.add(store);
    const app = buildAuthApp(config, store, new URL('http://localhost:3001'));
    const preflight = await app.fetch(
      authRequest('/token', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://client.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://client.example',
    );

    const untrusted = await app.fetch(
      authRequest('/.well-known/oauth-authorization-server', {
        headers: { Origin: 'https://evil.example' },
      }),
    );
    expect(untrusted.status).toBe(403);
    expect(untrusted.headers.has('Access-Control-Allow-Origin')).toBe(false);

    const response = await app.fetch(
      authRequest('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'x'.repeat(1_100) }),
      }),
    );
    expect(response.status).toBe(413);
  });

  test('keeps authorize/callback/token outside MCP and stores opaque RS mappings', async () => {
    const config = oauthConfig();
    const store = new MemoryTokenStore();
    stores.add(store);
    const app = buildAuthApp(config, store, new URL('http://localhost:3001'));
    const verifier = 'a'.repeat(64);
    const challenge = await challengeFor(verifier);
    const providerRequests: Array<{ url: string; authorization?: string | null }> = [];

    globalThis.fetch = Object.assign(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        providerRequests.push({
          url,
          authorization: new Headers(init?.headers).get('Authorization'),
        });
        if (url === 'https://client.example/oauth/metadata') {
          return Response.json({
            client_id: url,
            client_name: 'CIMD test client',
            redirect_uris: ['http://client.example/callback'],
          });
        }
        if (url === 'https://oauth2.googleapis.com/token') {
          return Response.json({
            access_token: 'gmail-provider-access',
            refresh_token: 'gmail-provider-refresh',
            expires_in: 3600,
            scope: 'gmail.readonly gmail.compose gmail.modify',
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
      { preconnect: originalFetch.preconnect },
    );

    const authorizeUrl = new URL('http://localhost:3001/authorize');
    authorizeUrl.searchParams.set('client_id', 'https://client.example/oauth/metadata');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', 'http://client.example/callback');
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('scope', 'gmail.readonly');
    authorizeUrl.searchParams.set('state', 'client-state');

    const authorize = await app.fetch(
      authRequest(`${authorizeUrl.pathname}${authorizeUrl.search}`),
    );
    expect(authorize.status).toBe(302);
    const providerRedirect = new URL(authorize.headers.get('Location') as string);
    expect(providerRedirect.origin + providerRedirect.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(providerRedirect.searchParams.get('code_challenge')).toBeNull();
    expect(providerRedirect.searchParams.get('access_type')).toBe('offline');
    expect(providerRedirect.searchParams.get('prompt')).toBe('consent');

    const compositeState = providerRedirect.searchParams.get('state');
    expect(compositeState).toBeTruthy();
    const callback = await app.fetch(
      authRequest(
        `/oauth/callback?code=google-code&state=${encodeURIComponent(compositeState as string)}`,
      ),
    );
    expect(callback.status).toBe(302);
    const clientRedirect = new URL(callback.headers.get('Location') as string);
    expect(clientRedirect.origin + clientRedirect.pathname).toBe(
      'http://client.example/callback',
    );
    expect(clientRedirect.searchParams.get('state')).toBe('client-state');

    const rsCode = clientRedirect.searchParams.get('code');
    const token = await app.fetch(
      authRequest('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: rsCode as string,
          code_verifier: verifier,
        }),
      }),
    );
    expect(token.status).toBe(200);
    const tokens = (await token.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(tokens.access_token).not.toBe('gmail-provider-access');
    expect(tokens.refresh_token).not.toBe('gmail-provider-refresh');

    const record = await store.getByRsAccess(tokens.access_token);
    expect(record?.provider).toEqual({
      access_token: 'gmail-provider-access',
      refresh_token: 'gmail-provider-refresh',
      expires_at: expect.any(Number),
      scopes: ['gmail.readonly', 'gmail.compose', 'gmail.modify'],
    });
    expect(providerRequests[0]?.url).toBe('https://client.example/oauth/metadata');
    expect(providerRequests[1]?.authorization).toMatch(/^Basic /);
  });

  test('preserves provider refresh semantics behind the RS refresh grant', async () => {
    const config = oauthConfig();
    const store = new MemoryTokenStore();
    stores.add(store);
    const app = buildAuthApp(config, store, new URL('http://localhost:3001'));
    await store.storeRsMapping(
      'mcp-access',
      {
        access_token: 'expired-gmail-access',
        refresh_token: 'gmail-refresh',
        expires_at: Date.now() - 1_000,
        scopes: ['gmail.readonly'],
      },
      'mcp-refresh',
    );

    globalThis.fetch = Object.assign(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        expect(input instanceof Request ? input.url : input.toString()).toBe(
          'https://oauth2.googleapis.com/token',
        );
        expect(String(init?.body)).toContain('refresh_token=gmail-refresh');
        return Response.json({
          access_token: 'fresh-gmail-access',
          refresh_token: 'gmail-refresh',
          expires_in: 3600,
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    const response = await app.fetch(
      authRequest('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'mcp-refresh',
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access_token: 'mcp-access',
      refresh_token: 'mcp-refresh',
      token_type: 'bearer',
      scope: 'gmail.readonly',
    });
    expect((await store.getByRsAccess('mcp-access'))?.provider.access_token).toBe(
      'fresh-gmail-access',
    );
  });

  test('rejects bad PKCE without consuming provider credentials', async () => {
    const config = oauthConfig();
    const store = new MemoryTokenStore();
    stores.add(store);
    const app = buildAuthApp(config, store, new URL('http://localhost:3001'));
    const verifier = 'b'.repeat(64);
    const challenge = await challengeFor(verifier);

    const authorize = await app.fetch(
      authRequest(
        `/authorize?redirect_uri=${encodeURIComponent('http://client.example/callback')}&code_challenge=${challenge}&code_challenge_method=S256&state=s`,
      ),
    );
    const state = new URL(authorize.headers.get('Location') as string).searchParams.get(
      'state',
    );

    globalThis.fetch = Object.assign(
      async () =>
        Response.json({
          access_token: 'gmail-access',
          expires_in: 3600,
          scope: 'gmail.readonly gmail.compose gmail.modify',
        }),
      { preconnect: originalFetch.preconnect },
    );
    const callback = await app.fetch(
      authRequest(
        `/oauth/callback?code=provider-code&state=${encodeURIComponent(state as string)}`,
      ),
    );
    const code = new URL(callback.headers.get('Location') as string).searchParams.get(
      'code',
    );

    const response = await app.fetch(
      authRequest('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          code_verifier: 'wrong-verifier',
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_grant' });
  });
});
