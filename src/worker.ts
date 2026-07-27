import { preloadSchemas } from '@modelcontextprotocol/server';
import { initializeWorkerStorage } from './adapters/http-workers/index.js';
import { buildHttpApp, type HttpRuntime } from './http/app.js';
import { authorizationServerBaseUrl } from './http/auth.js';
import { parseConfig } from './shared/config/env.js';

preloadSchemas();

export function createWorkerRuntime(env: Env): HttpRuntime {
  const config = parseConfig({ ...env });
  const storage = initializeWorkerStorage(env.TOKENS, config);
  return buildHttpApp(config, {
    runtimeName: 'cloudflare-workers',
    tokenStore: storage.tokenStore,
    authorizationServerBaseUrl: authorizationServerBaseUrl(
      config,
      new URL(config.MCP_PUBLIC_URL.origin),
    ),
    includeAuthorizationRoutes: true,
  });
}

let runtime: HttpRuntime | undefined;

export default {
  fetch(request, env) {
    runtime ??= createWorkerRuntime(env);
    return runtime.fetch(request);
  },
} satisfies ExportedHandler<Env>;
