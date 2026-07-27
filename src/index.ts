import { buildHttpApp } from './http/app.js';
import { bunAuthorizationServerBaseUrl } from './http/auth.js';
import { buildAuthApp } from './http/auth-app.js';
import { parseConfig } from './shared/config/env.js';
import { FileTokenStore } from './shared/storage/file.js';
import { MemorySessionStore } from './shared/storage/memory.js';
import { sharedLogger as logger } from './shared/utils/logger.js';

const config = parseConfig(process.env as Record<string, unknown>);
const tokenStore = new FileTokenStore(config.RS_TOKENS_FILE, config.RS_TOKENS_ENC_KEY);
// OAuth product storage remains available; it is not an MCP protocol session.
const oauthSessionStore = new MemorySessionStore();

const authorizationServerBaseUrl = bunAuthorizationServerBaseUrl(config);
const runtime = buildHttpApp(config, {
  runtimeName: 'bun',
  tokenStore,
  authorizationServerBaseUrl,
});
const mcpServer = Bun.serve({
  hostname: config.HOST,
  port: config.PORT,
  fetch: (request) => runtime.fetch(request),
});

const authServer = config.AUTH_ENABLED
  ? Bun.serve({
      hostname: config.HOST,
      port: config.PORT + 1,
      fetch: buildAuthApp(config, tokenStore, authorizationServerBaseUrl).fetch,
    })
  : undefined;

logger.info('server', {
  message: 'Gmail MCP server started',
  mcpUrl: config.MCP_PUBLIC_URL.href,
  oauthUrl: authServer ? authorizationServerBaseUrl.href : undefined,
  protocol: '2026-07-28',
  legacyMode: config.MCP_LEGACY_MODE,
  authEnabled: config.AUTH_ENABLED,
  tokenEncryption: Boolean(config.RS_TOKENS_ENC_KEY),
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server', { message: 'Shutting down', signal });

  tokenStore.flush();
  tokenStore.stopCleanup();
  oauthSessionStore.stopCleanup();

  const stops = [mcpServer.stop(false)];
  if (authServer) stops.push(authServer.stop(false));
  await runtime.close();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stopped = await Promise.race([
    Promise.all(stops).then(() => true),
    new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), 5_000);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (!stopped) {
    await mcpServer.stop(true);
    if (authServer) await authServer.stop(true);
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
