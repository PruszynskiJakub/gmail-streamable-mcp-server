import { afterEach, describe, expect, test } from 'bun:test';
import {
  Client,
  type FetchLike,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { buildHttpApp, type HttpRuntime } from '../src/http/app.js';
import { createOpaqueTokenVerifier } from '../src/shared/auth/opaque-token-verifier.js';
import type { UnifiedConfig } from '../src/shared/config/env.js';
import { parseConfig } from '../src/shared/config/env.js';
import { MemoryTokenStore } from '../src/shared/storage/memory.js';

interface Exchange {
  method: string;
  requestHeaders: Headers;
  status: number;
  responseHeaders: Headers;
}

interface TestConnection {
  client: Client;
  exchanges: Exchange[];
}

const originalFetch = globalThis.fetch;
const activeRuntimes = new Set<HttpRuntime>();
const activeClients = new Set<Client>();
const activeStores = new Set<MemoryTokenStore>();

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all([...activeClients].map((client) => client.close()));
  await Promise.all([...activeRuntimes].map((runtime) => runtime.close()));
  for (const store of activeStores) store.stopCleanup();
  activeClients.clear();
  activeRuntimes.clear();
  activeStores.clear();
});

function testConfig(overrides: Record<string, unknown> = {}): UnifiedConfig {
  return parseConfig({
    NODE_ENV: 'test',
    MCP_PUBLIC_URL: 'http://localhost:3000/mcp',
    MCP_ALLOWED_HOSTS: 'localhost',
    MCP_ALLOWED_ORIGIN_HOSTNAMES: 'localhost',
    MCP_TITLE: 'Gmail',
    MCP_NAME: 'gmail-mcp',
    MCP_VERSION: '1.0.0',
    ...overrides,
  });
}

function authConfig(overrides: Record<string, unknown> = {}): UnifiedConfig {
  return testConfig({
    AUTH_ENABLED: 'true',
    AUTH_STRATEGY: 'oauth',
    OAUTH_SCOPES: 'gmail.readonly',
    AUTH_REQUIRED_SCOPES: 'gmail.readonly',
    ...overrides,
  });
}

function createRuntime(
  config = testConfig(),
  store = new MemoryTokenStore(),
  verifier?: OAuthTokenVerifier,
): { runtime: HttpRuntime; store: MemoryTokenStore } {
  const runtime = buildHttpApp(config, {
    runtimeName: 'test',
    tokenStore: store,
    authorizationServerBaseUrl: new URL('http://localhost:3001'),
    ...(verifier ? { verifier } : {}),
  });
  activeRuntimes.add(runtime);
  activeStores.add(store);
  return { runtime, store };
}

function runtimeFetch(
  runtime: HttpRuntime,
  exchanges: Exchange[],
  token?: string,
): FetchLike {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Host', 'localhost:3000');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await runtime.fetch(new Request(url, { ...init, headers }));
    exchanges.push({
      method: init?.method ?? 'GET',
      requestHeaders: new Headers(headers),
      status: response.status,
      responseHeaders: new Headers(response.headers),
    });
    return response;
  };
}

async function connect(
  runtime: HttpRuntime,
  mode: 'modern' | 'legacy',
  token?: string,
): Promise<TestConnection> {
  const exchanges: Exchange[] = [];
  const client = new Client(
    { name: `gmail-test-${mode}`, version: '1.0.0' },
    mode === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : undefined,
  );
  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost:3000/mcp'),
    {
      fetch: runtimeFetch(runtime, exchanges, token),
      ...(token ? { authProvider: { token: async () => token } } : {}),
    },
  );
  await client.connect(transport);
  activeClients.add(client);
  return { client, exchanges };
}

function installGmailProfileMock(seenTokens: string[]): void {
  globalThis.fetch = Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (!url.endsWith('/gmail/v1/users/me/profile')) {
        throw new Error(`Unexpected provider request: ${url}`);
      }
      const token = new Headers(init?.headers)
        .get('Authorization')
        ?.replace(/^Bearer\s+/, '');
      if (!token) return Response.json({ error: 'missing token' }, { status: 401 });
      seenTokens.push(token);
      const email = token === 'gmail-alice' ? 'alice@example.com' : 'bob@example.com';
      return Response.json({ emailAddress: email });
    },
    { preconnect: originalFetch.preconnect },
  );
}

async function addPrincipal(
  store: MemoryTokenStore,
  mcpToken: string,
  gmailToken: string,
  scopes = ['gmail.readonly'],
): Promise<void> {
  await store.storeRsMapping(mcpToken, {
    access_token: gmailToken,
    refresh_token: `refresh-${gmailToken}`,
    expires_at: Date.now() + 300_000,
    scopes,
  });
}

describe('MCP 2026-07-28 and stateless legacy', () => {
  test('uses the official client for the exact modern Gmail contract', async () => {
    const { runtime } = createRuntime();
    const { client, exchanges } = await connect(runtime, 'modern');

    expect(client.getProtocolEra()).toBe('modern');
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    expect(client.getServerCapabilities()).toEqual({
      logging: {},
      tools: { listChanged: true },
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'get_profile',
      'inbox_overview',
      'list_labels',
      'modify_thread',
      'search_threads',
      'get_thread',
      'get_message',
      'create_draft',
      'update_draft',
      'send_draft',
    ]);
    expect(tools.tools).toMatchSnapshot();

    for (const exchange of exchanges.filter(
      (item) => item.requestHeaders.get('MCP-Protocol-Version') === '2026-07-28',
    )) {
      expect(exchange.requestHeaders.has('Mcp-Session-Id')).toBe(false);
      expect(exchange.responseHeaders.has('Mcp-Session-Id')).toBe(false);
    }
  });

  test('uses the official client stateless legacy fallback', async () => {
    const seenTokens: string[] = [];
    installGmailProfileMock(seenTokens);
    const { runtime, store } = createRuntime(authConfig());
    await addPrincipal(store, 'mcp-legacy', 'gmail-alice');
    const { client, exchanges } = await connect(runtime, 'legacy', 'mcp-legacy');

    expect(client.getProtocolEra()).toBe('legacy');
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    expect(client.getServerCapabilities()).toEqual({
      logging: {},
      tools: { listChanged: false },
    });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'get_profile',
      'inbox_overview',
      'list_labels',
      'modify_thread',
      'search_threads',
      'get_thread',
      'get_message',
      'create_draft',
      'update_draft',
      'send_draft',
    ]);
    expect(
      (await client.callTool({ name: 'get_profile', arguments: {} })).structuredContent,
    ).toEqual({ email: 'alice@example.com' });
    expect(seenTokens).toEqual(['gmail-alice']);
    expect(
      exchanges.every((exchange) => !exchange.responseHeaders.has('Mcp-Session-Id')),
    ).toBe(true);
  });

  test('leaves protocol errors and modern header mismatch to the SDK', async () => {
    const { runtime } = createRuntime();
    for (const method of ['GET', 'DELETE']) {
      const response = await runtime.fetch(
        new Request('http://localhost:3000/mcp', {
          method,
          headers: { Host: 'localhost:3000' },
        }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.has('Mcp-Session-Id')).toBe(false);
    }

    const mismatch = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'server/discover',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': {
                name: 'raw-test',
                version: '1.0.0',
              },
            },
          },
        }),
      }),
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ error: { code: -32020 } });

    const unsupportedVersion = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '1900-01-01',
          'Mcp-Method': 'server/discover',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'server/discover',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '1900-01-01',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': {
                name: 'unsupported-test',
                version: '1.0.0',
              },
            },
          },
        }),
      }),
    );
    expect(unsupportedVersion.status).toBe(400);
    expect(await unsupportedVersion.json()).toMatchObject({
      error: { code: -32022 },
    });

    const unsupportedMedia = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          'Content-Type': 'text/plain',
        },
        body: '{}',
      }),
    );
    expect(unsupportedMedia.status).toBe(415);
  });
});

describe('HTTP and opaque OAuth resource-server boundary', () => {
  test('enforces Host, Origin, CORS, and bounded request bodies', async () => {
    const { runtime } = createRuntime(testConfig({ MCP_MAX_REQUEST_BYTES: '1024' }));

    const badHost = await runtime.fetch(
      new Request('http://localhost:3000/health', {
        headers: { Host: 'evil.example' },
      }),
    );
    expect(badHost.status).toBe(403);

    const badOrigin = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
    );
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.headers.has('Access-Control-Allow-Origin')).toBe(false);

    const preflight = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'OPTIONS',
        headers: {
          Host: 'localhost:3000',
          Origin: 'http://localhost:8080',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers':
            'authorization, content-type, mcp-param-tenant',
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:8080',
    );

    const oversized = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          'Content-Type': 'application/json',
        },
        body: 'x'.repeat(1_025),
      }),
    );
    expect(oversized.status).toBe(413);
  });

  test('serves metadata and returns 401, invalid-token 401, and scope 403', async () => {
    const config = authConfig();
    const { runtime, store } = createRuntime(config);
    await addPrincipal(store, 'limited-mcp', 'gmail-limited', ['other.scope']);
    await addPrincipal(store, 'legacy-no-scope', 'gmail-legacy', []);
    expect(
      (
        await createOpaqueTokenVerifier(config, store).verifyAccessToken(
          'legacy-no-scope',
        )
      ).scopes,
    ).toEqual(['gmail.readonly']);

    const metadata = await runtime.fetch(
      new Request('http://localhost:3000/.well-known/oauth-protected-resource/mcp', {
        headers: { Host: 'localhost:3000' },
      }),
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: 'http://localhost:3000/mcp',
      authorization_servers: ['http://localhost:3001'],
      scopes_supported: ['gmail.readonly'],
    });
    for (const alias of [
      '/.well-known/oauth-protected-resource',
      '/mcp/.well-known/oauth-protected-resource',
      '/mcp/.well-known/oauth-authorization-server',
    ]) {
      expect(
        (
          await runtime.fetch(
            new Request(`http://localhost:3000${alias}`, {
              headers: { Host: 'localhost:3000' },
            }),
          )
        ).status,
      ).toBe(200);
    }

    const missing = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'GET',
        headers: { Host: 'localhost:3000' },
      }),
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get('WWW-Authenticate')).toContain('resource_metadata=');

    const invalid = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'GET',
        headers: {
          Host: 'localhost:3000',
          Authorization: 'Bearer invalid-mcp-token',
        },
      }),
    );
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({ error: 'invalid_token' });

    const insufficient = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'GET',
        headers: {
          Host: 'localhost:3000',
          Authorization: 'Bearer limited-mcp',
        },
      }),
    );
    expect(insufficient.status).toBe(403);
    expect(insufficient.headers.get('WWW-Authenticate')).toContain(
      'insufficient_scope',
    );
  });

  test('propagates official-client cancellation to the provider fetch signal', async () => {
    let markAborted: (() => void) | undefined;
    const providerAborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    globalThis.fetch = Object.assign(
      async (_input: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              markAborted?.();
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        }),
      { preconnect: originalFetch.preconnect },
    );
    const { runtime, store } = createRuntime(authConfig());
    await addPrincipal(store, 'mcp-cancel', 'gmail-cancel');
    const { client } = await connect(runtime, 'modern', 'mcp-cancel');
    const controller = new AbortController();
    const pending = client.callTool(
      { name: 'get_profile', arguments: {} },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow();
    await Promise.race([
      providerAborted,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Provider fetch was not aborted')), 1_000),
      ),
    ]);
  });

  test('never forwards the MCP bearer and isolates concurrent principals', async () => {
    const seenTokens: string[] = [];
    installGmailProfileMock(seenTokens);
    const { runtime, store } = createRuntime(authConfig());
    await Promise.all([
      addPrincipal(store, 'mcp-alice', 'gmail-alice'),
      addPrincipal(store, 'mcp-bob', 'gmail-bob'),
    ]);
    const authInfo = await createOpaqueTokenVerifier(
      authConfig(),
      store,
    ).verifyAccessToken('mcp-alice');
    expect(authInfo.extra).toEqual({ gmailAccessToken: 'gmail-alice' });
    expect(JSON.stringify(authInfo.extra)).not.toContain('refresh-gmail-alice');

    const [alice, bob] = await Promise.all([
      connect(runtime, 'modern', 'mcp-alice'),
      connect(runtime, 'modern', 'mcp-bob'),
    ]);
    const [aliceResult, bobResult] = await Promise.all([
      alice.client.callTool({ name: 'get_profile', arguments: {} }),
      bob.client.callTool({ name: 'get_profile', arguments: {} }),
    ]);

    expect(aliceResult.structuredContent).toEqual({
      email: 'alice@example.com',
    });
    expect(bobResult.structuredContent).toEqual({ email: 'bob@example.com' });
    expect(seenTokens.sort()).toEqual(['gmail-alice', 'gmail-bob']);
    expect(seenTokens).not.toContain('mcp-alice');
    expect(seenTokens).not.toContain('mcp-bob');
  });
});
