export type AuthStrategyType = 'oauth' | 'bearer' | 'api_key' | 'custom' | 'none';
export type RuntimeEnvironment = 'development' | 'production' | 'test';
export type LegacyMode = 'stateless' | 'reject';
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface UnifiedConfig {
  HOST: string;
  PORT: number;
  NODE_ENV: RuntimeEnvironment;
  LOG_LEVEL: LogLevel;

  MCP_NAME: string;
  MCP_TITLE: string;
  MCP_VERSION: string;
  MCP_DESCRIPTION: string;
  MCP_INSTRUCTIONS: string;
  MCP_PUBLIC_URL: URL;
  MCP_WEBSITE_URL?: URL;
  MCP_ALLOWED_HOSTS: string[];
  MCP_ALLOWED_ORIGIN_HOSTNAMES: string[];
  MCP_LEGACY_MODE: LegacyMode;
  MCP_MAX_REQUEST_BYTES: number;

  AUTH_STRATEGY: AuthStrategyType;
  AUTH_ENABLED: boolean;
  AUTH_RESOURCE_URI?: string;
  AUTH_DISCOVERY_URL?: string;
  AUTH_REQUIRED_SCOPES: string[];

  API_KEY?: string;
  API_KEY_HEADER: string;
  BEARER_TOKEN?: string;
  CUSTOM_HEADERS?: string;

  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
  OAUTH_SCOPES: string;
  OAUTH_AUTHORIZATION_URL?: string;
  OAUTH_TOKEN_URL?: string;
  OAUTH_REVOCATION_URL?: string;
  OAUTH_REDIRECT_URI: string;
  OAUTH_REDIRECT_ALLOWLIST: string[];
  OAUTH_REDIRECT_ALLOW_ALL: boolean;
  OAUTH_EXTRA_AUTH_PARAMS?: string;
  OAUTH_PROXY_PUBLIC_URL?: URL;

  CIMD_ENABLED: boolean;
  CIMD_FETCH_TIMEOUT_MS: number;
  CIMD_MAX_RESPONSE_BYTES: number;
  CIMD_ALLOWED_DOMAINS: string[];

  PROVIDER_CLIENT_ID?: string;
  PROVIDER_CLIENT_SECRET?: string;
  PROVIDER_API_URL?: string;
  PROVIDER_ACCOUNTS_URL?: string;

  RS_TOKENS_FILE?: string;
  RS_TOKENS_ENC_KEY?: string;

  RPS_LIMIT: number;
  CONCURRENCY_LIMIT: number;
}

function stringValue(env: Record<string, unknown>, key: string, fallback = ''): string {
  const value = env[key];
  return value === undefined || value === null || value === ''
    ? fallback
    : String(value).trim();
}

function optionalString(env: Record<string, unknown>, key: string): string | undefined {
  const value = stringValue(env, key);
  return value || undefined;
}

function booleanValue(
  env: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`${key} must be true or false`);
}

function integerValue(
  env: Record<string, unknown>,
  key: string,
  fallback: number,
  min = 1,
  max = 65_535,
): number {
  const value = Number(stringValue(env, key, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function listValue(
  env: Record<string, unknown>,
  key: string,
  fallback: string[] = [],
  separator: RegExp = /[ ,]+/,
): string[] {
  const value = stringValue(env, key);
  if (!value) return [...fallback];
  return [
    ...new Set(
      value
        .split(separator)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function enumValue<T extends string>(
  env: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = stringValue(env, key, fallback) as T;
  if (!values.includes(value)) {
    throw new Error(`${key} must be one of: ${values.join(', ')}`);
  }
  return value;
}

function urlValue(
  env: Record<string, unknown>,
  key: string,
  fallback?: string,
): URL | undefined {
  const value = stringValue(env, key, fallback);
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute URL`);
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function validateSecureUrl(
  url: URL,
  key: string,
  environment: RuntimeEnvironment,
): void {
  if (
    environment === 'production' &&
    url.protocol !== 'https:' &&
    !isLoopback(url.hostname)
  ) {
    throw new Error(`${key} must use HTTPS in production`);
  }
}

function parseAuthStrategy(env: Record<string, unknown>): AuthStrategyType {
  const explicit = optionalString(env, 'AUTH_STRATEGY')?.toLowerCase();
  if (explicit) {
    const allowed: AuthStrategyType[] = [
      'oauth',
      'bearer',
      'api_key',
      'custom',
      'none',
    ];
    if (!allowed.includes(explicit as AuthStrategyType)) {
      throw new Error(`AUTH_STRATEGY must be one of: ${allowed.join(', ')}`);
    }
    return explicit as AuthStrategyType;
  }
  if (booleanValue(env, 'AUTH_ENABLED')) return 'oauth';
  if (optionalString(env, 'API_KEY')) return 'api_key';
  if (optionalString(env, 'BEARER_TOKEN')) return 'bearer';
  return 'none';
}

export function parseConfig(env: Record<string, unknown>): UnifiedConfig {
  const port = integerValue(env, 'PORT', 3000);
  const environment = enumValue(
    env,
    'NODE_ENV',
    ['development', 'production', 'test'] as const,
    'development',
  );
  const configuredPublicUrl = optionalString(env, 'MCP_PUBLIC_URL');
  if (environment === 'production' && !configuredPublicUrl) {
    throw new Error('MCP_PUBLIC_URL is required in production');
  }
  const publicUrl = urlValue(
    env,
    'MCP_PUBLIC_URL',
    `http://localhost:${port}/mcp`,
  ) as URL;
  if (publicUrl.search || publicUrl.hash) {
    throw new Error('MCP_PUBLIC_URL must not include a query string or fragment');
  }
  validateSecureUrl(publicUrl, 'MCP_PUBLIC_URL', environment);

  const defaultHosts = [publicUrl.hostname];
  if (environment !== 'production') {
    defaultHosts.push('localhost', '127.0.0.1', '[::1]');
  }
  const allowedHosts = listValue(env, 'MCP_ALLOWED_HOSTS', defaultHosts);
  const allowedOrigins = listValue(env, 'MCP_ALLOWED_ORIGIN_HOSTNAMES', defaultHosts);
  if (allowedHosts.length === 0 || allowedOrigins.length === 0) {
    throw new Error('MCP Host and Origin allowlists must not be empty');
  }

  const authStrategy = parseAuthStrategy(env);
  const authEnabled =
    authStrategy === 'oauth' || booleanValue(env, 'AUTH_ENABLED', false);
  const configuredResourceUrl = urlValue(env, 'AUTH_RESOURCE_URI');
  if (configuredResourceUrl && configuredResourceUrl.href !== publicUrl.href) {
    throw new Error('AUTH_RESOURCE_URI must exactly match MCP_PUBLIC_URL');
  }
  const mcpTitle = stringValue(env, 'MCP_TITLE', 'MCP Server Template');
  const oauthScopes = stringValue(env, 'OAUTH_SCOPES');
  const requiredScopes = listValue(
    env,
    'AUTH_REQUIRED_SCOPES',
    oauthScopes.split(/\s+/).filter(Boolean),
  );

  const authorizationUrl = optionalString(env, 'OAUTH_AUTHORIZATION_URL');
  const tokenUrl = optionalString(env, 'OAUTH_TOKEN_URL');
  const revocationUrl = optionalString(env, 'OAUTH_REVOCATION_URL');
  const proxyPublicUrl = urlValue(env, 'OAUTH_PROXY_PUBLIC_URL');
  for (const [key, value] of [
    ['OAUTH_AUTHORIZATION_URL', authorizationUrl],
    ['OAUTH_TOKEN_URL', tokenUrl],
    ['OAUTH_REVOCATION_URL', revocationUrl],
  ] as const) {
    if (value) validateSecureUrl(new URL(value), key, environment);
  }
  if (proxyPublicUrl) {
    validateSecureUrl(proxyPublicUrl, 'OAUTH_PROXY_PUBLIC_URL', environment);
  }

  return {
    HOST: stringValue(env, 'HOST', '127.0.0.1'),
    PORT: port,
    NODE_ENV: environment,
    LOG_LEVEL: enumValue(
      env,
      'LOG_LEVEL',
      ['debug', 'info', 'warning', 'error'] as const,
      'info',
    ),

    MCP_NAME: stringValue(env, 'MCP_NAME', mcpTitle),
    MCP_TITLE: mcpTitle,
    MCP_VERSION: stringValue(env, 'MCP_VERSION', '0.1.0'),
    MCP_DESCRIPTION: stringValue(
      env,
      'MCP_DESCRIPTION',
      'Search, read, draft, send, and organize Gmail messages.',
    ),
    MCP_INSTRUCTIONS: stringValue(env, 'MCP_INSTRUCTIONS'),
    MCP_PUBLIC_URL: publicUrl,
    MCP_WEBSITE_URL: urlValue(env, 'MCP_WEBSITE_URL'),
    MCP_ALLOWED_HOSTS: allowedHosts,
    MCP_ALLOWED_ORIGIN_HOSTNAMES: allowedOrigins,
    MCP_LEGACY_MODE: enumValue(
      env,
      'MCP_LEGACY_MODE',
      ['stateless', 'reject'] as const,
      'stateless',
    ),
    MCP_MAX_REQUEST_BYTES: integerValue(
      env,
      'MCP_MAX_REQUEST_BYTES',
      1_048_576,
      1_024,
      10_485_760,
    ),

    AUTH_STRATEGY: authStrategy,
    AUTH_ENABLED: authEnabled,
    AUTH_RESOURCE_URI: configuredResourceUrl?.href,
    AUTH_DISCOVERY_URL: optionalString(env, 'AUTH_DISCOVERY_URL'),
    AUTH_REQUIRED_SCOPES: requiredScopes,

    API_KEY: optionalString(env, 'API_KEY'),
    API_KEY_HEADER: stringValue(env, 'API_KEY_HEADER', 'x-api-key'),
    BEARER_TOKEN: optionalString(env, 'BEARER_TOKEN'),
    CUSTOM_HEADERS: optionalString(env, 'CUSTOM_HEADERS'),

    OAUTH_CLIENT_ID: optionalString(env, 'OAUTH_CLIENT_ID'),
    OAUTH_CLIENT_SECRET: optionalString(env, 'OAUTH_CLIENT_SECRET'),
    OAUTH_SCOPES: oauthScopes,
    OAUTH_AUTHORIZATION_URL: authorizationUrl,
    OAUTH_TOKEN_URL: tokenUrl,
    OAUTH_REVOCATION_URL: revocationUrl,
    OAUTH_REDIRECT_URI: stringValue(
      env,
      'OAUTH_REDIRECT_URI',
      'http://localhost:3001/oauth/callback',
    ),
    OAUTH_REDIRECT_ALLOWLIST: listValue(env, 'OAUTH_REDIRECT_ALLOWLIST', [], /,/),
    OAUTH_REDIRECT_ALLOW_ALL: booleanValue(env, 'OAUTH_REDIRECT_ALLOW_ALL', false),
    OAUTH_EXTRA_AUTH_PARAMS: optionalString(env, 'OAUTH_EXTRA_AUTH_PARAMS'),
    OAUTH_PROXY_PUBLIC_URL: proxyPublicUrl,

    CIMD_ENABLED: booleanValue(env, 'CIMD_ENABLED', true),
    CIMD_FETCH_TIMEOUT_MS: integerValue(
      env,
      'CIMD_FETCH_TIMEOUT_MS',
      5_000,
      100,
      60_000,
    ),
    CIMD_MAX_RESPONSE_BYTES: integerValue(
      env,
      'CIMD_MAX_RESPONSE_BYTES',
      65_536,
      1_024,
      1_048_576,
    ),
    CIMD_ALLOWED_DOMAINS: listValue(env, 'CIMD_ALLOWED_DOMAINS'),

    PROVIDER_CLIENT_ID: optionalString(env, 'PROVIDER_CLIENT_ID'),
    PROVIDER_CLIENT_SECRET: optionalString(env, 'PROVIDER_CLIENT_SECRET'),
    PROVIDER_API_URL: optionalString(env, 'PROVIDER_API_URL'),
    PROVIDER_ACCOUNTS_URL: optionalString(env, 'PROVIDER_ACCOUNTS_URL'),

    RS_TOKENS_FILE: optionalString(env, 'RS_TOKENS_FILE'),
    RS_TOKENS_ENC_KEY: optionalString(env, 'RS_TOKENS_ENC_KEY'),

    RPS_LIMIT: integerValue(env, 'RPS_LIMIT', 10, 1, 100_000),
    CONCURRENCY_LIMIT: integerValue(env, 'CONCURRENCY_LIMIT', 5, 1, 10_000),
  };
}

export function resolveConfig(): UnifiedConfig {
  return parseConfig(process.env as Record<string, unknown>);
}
