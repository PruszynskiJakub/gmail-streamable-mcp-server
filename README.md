# Gmail MCP Server

Fetch-native MCP server for Gmail — search threads, read messages, manage drafts, and organize your inbox on Bun or Cloudflare Workers.

Author: [overment](https://x.com/_overment)

> [!IMPORTANT]
> This branch targets the **candidate** `2026-07-28` protocol using exact `@modelcontextprotocol/server@2.0.0-beta.5` and `@modelcontextprotocol/client@2.0.0-beta.5`. These packages are prereleases. Do not claim final `2026-07-28` conformance until the dated specification and stable packages are published and the final-delta validation passes.

> [!WARNING]
> You connect this server to your MCP client at your own responsibility. Language models can make mistakes or perform unintended actions. Review tool outputs, verify writes in Gmail, and prefer small, incremental changes. Remote deployments still need TLS, rate limiting, audit logging, secret management, and compliance with Google OAuth policies.

The same tool and OAuth product behavior is available in two runtimes:
- **Bun** with the MCP resource server on `PORT` and OAuth proxy on `PORT + 1`
- **Cloudflare Workers** with MCP, discovery, and OAuth proxy routes on one origin

## Motivation

Gmail's API is powerful but not LLM-friendly out of the box. This server focuses on:

- Let LLMs understand inbox state in a **single action** (`inbox_overview`) instead of multiple queries
- Provide **enriched search results** with subject, sender, date — not just thread IDs
- Support **batch operations** (`modify_thread` handles up to 100 threads at once)
- Map API responses into **human-readable feedback** useful for both LLM and user
- Safer write flow: **drafts first, send explicitly**

In short, it's not a direct mirror of Gmail's API — it's tailored so AI agents know exactly how to use it effectively.

## Features

- ✅ **Overview** — Get inbox stats + highlights (unread, starred, recent threads)
- ✅ **Search** — Find threads with Gmail query syntax, enriched results
- ✅ **Read** — Get full threads and messages with body content
- ✅ **Labels** — Discover label IDs for filtering and organizing
- ✅ **Modify** — Batch archive, star, mark read/unread (up to 100 threads)
- ✅ **Drafts** — Create, update, and send drafts with reply threading
- ✅ **OAuth 2.1** — CIMD + PKCE proxy with opaque MCP resource-token mapping
- ✅ **Credential separation** — MCP bearer tokens are never sent to Gmail; provider refresh tokens stay in storage
- ✅ **Dual Runtime** — Bun and Cloudflare Workers
- ✅ **MCP v2 candidate** — Fetch-native `2026-07-28` with SDK stateless legacy fallback

### Design Principles

- **LLM-friendly**: Tools are simplified, not 1:1 Gmail API mirrors
- **Discovery-first**: `inbox_overview` and `list_labels` help avoid guessing
- **Batch-first**: `modify_thread` accepts arrays to minimize tool calls
- **Safer writes**: Drafts first, send explicitly
- **Clear feedback**: Summaries with structured content and next steps

---

## Installation

Prerequisites: [Bun](https://bun.sh/) 1.2+, a Google account, and a Gmail-enabled Google Cloud project. Cloudflare deployment also requires a Cloudflare account and Wrangler 4.

### Ways to Run (Pick One)

1. **Local + OAuth** (recommended)
2. **Cloudflare Worker (wrangler dev)** — Local Worker testing
3. **Cloudflare Worker (deploy)** — Remote production

---

### 1. Local + OAuth (Recommended)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project and enable the **Gmail API**
3. Create **OAuth 2.0 Client ID** (Web application)
4. Set redirect URIs:
   ```
   http://127.0.0.1:3001/oauth/callback
   alice://oauth/callback
   ```
5. Copy Client ID and Secret

```bash
cd gmail-mcp
bun install
cp env.example .env
```

Edit `.env`:

```env
PORT=3000
AUTH_ENABLED=true
AUTH_STRATEGY=oauth

PROVIDER_CLIENT_ID=your-client-id.apps.googleusercontent.com
PROVIDER_CLIENT_SECRET=your-client-secret
PROVIDER_ACCOUNTS_URL=https://accounts.google.com

OAUTH_AUTHORIZATION_URL=https://accounts.google.com/o/oauth2/v2/auth
OAUTH_TOKEN_URL=https://oauth2.googleapis.com/token
OAUTH_REVOCATION_URL=https://oauth2.googleapis.com/revoke
OAUTH_SCOPES=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.modify

OAUTH_REDIRECT_URI=alice://oauth/callback
OAUTH_REDIRECT_ALLOWLIST=alice://oauth/callback,http://127.0.0.1:3001/oauth/callback
OAUTH_EXTRA_AUTH_PARAMS=access_type=offline&prompt=consent
```

Run:

```bash
bun dev
# MCP: http://127.0.0.1:3000/mcp
# OAuth: http://127.0.0.1:3001
```

> **Tip:** The Authorization Server runs on PORT + 1.

---

### 2. Cloudflare Worker (Local Dev)

Create an ignored `.dev.vars` for local Worker secrets:

```dotenv
PROVIDER_CLIENT_ID=your-client-id.apps.googleusercontent.com
PROVIDER_CLIENT_SECRET=your-client-secret
RS_TOKENS_ENC_KEY=your-base64url-32-byte-key
```

Then run:

```bash
bun run dev:worker
```

Endpoint: `http://127.0.0.1:8787/mcp`

---

### 3. Cloudflare Worker (Deploy)

1. Create KV namespace:

```bash
bun x wrangler kv namespace create TOKENS
```

2. Replace the placeholder URLs, host allowlist, and KV namespace ID in `wrangler.jsonc`.

3. Set secrets:

```bash
bun x wrangler secret put PROVIDER_CLIENT_ID
bun x wrangler secret put PROVIDER_CLIENT_SECRET

# Generate encryption key (32-byte base64url):
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
bun x wrangler secret put RS_TOKENS_ENC_KEY
```

> **Note:** `RS_TOKENS_ENC_KEY` encrypts OAuth tokens stored in KV (AES-256-GCM).

4. Update the redirect URI and allowlist in `wrangler.jsonc`.

5. Add Workers URL to your Google OAuth app's redirect URIs

6. Deploy:

```bash
bun x wrangler deploy
```

Endpoint: `https://<worker-name>.<account>.workers.dev/mcp`

---

## Client Configuration

**MCP Inspector (quick test):**

```bash
bunx @modelcontextprotocol/inspector
# Connect to: http://localhost:3000/mcp
```

**Claude Desktop / Cursor:**

```json
{
  "mcpServers": {
    "gmail": {
      "command": "bunx",
      "args": ["mcp-remote", "http://127.0.0.1:3000/mcp", "--transport", "http-only"],
      "env": { "NO_PROXY": "127.0.0.1,localhost" }
    }
  }
}
```

For Cloudflare, replace URL with `https://<worker-name>.<account>.workers.dev/mcp`.

---

## Token and request flow

OAuth authorization state is product state, not an MCP transport session. It remains in `TokenStore` implementations while every MCP request receives a fresh SDK server.

```mermaid
sequenceDiagram
  participant C as MCP client
  participant AS as Gmail MCP OAuth proxy
  participant G as Google OAuth
  participant S as TokenStore (file/KV + memory)
  participant R as /mcp resource server
  participant API as Gmail API

  C->>AS: GET /authorize (CIMD client_id, PKCE challenge)
  AS->>S: Save short-lived authorization transaction
  AS->>G: Redirect to Google authorization
  G->>AS: GET /oauth/callback (provider code)
  AS->>G: Exchange code for Google access + refresh tokens
  AS->>S: Keep provider tokens in authorization transaction
  AS->>C: Redirect with one-time proxy authorization code
  C->>AS: POST /token (code + PKCE verifier)
  AS->>S: Store opaque MCP access/refresh -> provider-token record
  AS-->>C: Opaque MCP access + refresh tokens
  C->>R: MCP request with opaque MCP bearer
  R->>S: Validate record; refresh provider access if near expiry
  S-->>R: Provider access token only
  R->>API: Gmail request with provider access token
  API-->>R: Gmail response
  R-->>C: MCP tool result
```

Trust boundary rules:

- The inbound MCP bearer is retained only as `AuthInfo.token` by the SDK auth boundary; tools cannot read or forward it. OAuth mode always requires a valid opaque RS record; the older permissive `AUTH_REQUIRE_RS` and `AUTH_ALLOW_DIRECT_BEARER` toggles were removed.
- The current Gmail access token is exposed to tools only as `AuthInfo.extra.gmailAccessToken` through the project-specific context adapter.
- Google refresh tokens never enter `AuthInfo`, tool context, MCP content, or structured output.
- `/authorize`, `/oauth/callback`, `/token`, `/revoke`, `/register`, and discovery routes are dispatched before and outside MCP handling.
- Modern requests and legacy fallback are stateless and never create `Mcp-Session-Id`.

---

## Tools

### `get_profile`

Get the connected Gmail account email. Call to confirm which account is active.

```ts
// Input
{}

// Output
{ email: "user@gmail.com" }
```

### `inbox_overview`

Get inbox stats + highlights for a time range. **Call this first** for a quick summary.

```ts
// Input
{
  days?: number;  // 1-365, default: 7
}

// Output
{
  period: "last 7 days",
  counts: { total, unread, inbox, sent, starred, important? },
  highlights?: {
    recentUnread: Array<{ id, subject?, from? }>,
    starred: Array<{ id, subject?, from? }>
  },
  meta?: { nextSteps? }
}
```

### `list_labels`

Discover label IDs and names. Use before filtering by labelIds.

```ts
// Input
{}

// Output
{
  items: Array<{ id, name, type?, messagesTotal?, threadsTotal? }>,
  meta?: { nextSteps?, relatedTools? }
}
```

### `search_threads`

Search threads with Gmail query syntax. Returns enriched results.

```ts
// Input
{
  query?: string;            // Gmail search: "from:alice newer_than:7d"
  labelIds?: string[];
  includeSpamTrash?: boolean;
  limit?: number;            // 1-50, default: 25
  cursor?: string;
}

// Output
{
  items: Array<{
    id, subject?, from?, date?, snippet?,
    messageCount?, isUnread?, webUrl?
  }>,
  pagination?: { hasMore, nextCursor?, itemsReturned, limit },
  meta?: { nextSteps?, hints?, relatedTools? }
}
```

### `get_thread`

Get a full thread with all messages.

```ts
// Input
{
  threadId: string;
  format?: "minimal" | "metadata" | "full" | "raw";
  metadataHeaders?: string[];
  maxBodyChars?: number;
}

// Output
{
  thread: { id, historyId?, messageCount, messages: [...], webUrl? },
  meta?: { nextSteps?, relatedTools? }
}
```

### `get_message`

Fetch a single message with full content.

```ts
// Input
{
  messageId: string;
  format?: "minimal" | "metadata" | "full" | "raw";
  metadataHeaders?: string[];
  maxBodyChars?: number;
}

// Output
{
  message: { id, threadId?, snippet?, headers?, body?, webUrl? },
  meta?: { nextSteps?, relatedTools? }
}
```

### `modify_thread`

Batch add/remove labels on threads (up to 100). Supports convenience actions.

```ts
// Input
{
  threadIds: string[];        // 1-100 thread IDs
  addLabelIds?: string[];
  removeLabelIds?: string[];
  actions?: {
    archive?: boolean;        // Remove INBOX
    unarchive?: boolean;      // Add INBOX
    markRead?: boolean;       // Remove UNREAD
    markUnread?: boolean;     // Add UNREAD
    star?: boolean;           // Add STARRED
    unstar?: boolean;         // Remove STARRED
    trash?: boolean;
    untrash?: boolean;
  };
}

// Output
{
  results: Array<{ threadId, success, error? }>,
  summary: { total, succeeded, failed },
  applied: { addLabelIds?, removeLabelIds? },
  meta?: { nextSteps?, relatedTools? }
}
```

### `create_draft`

Create a draft from structured fields or raw MIME.

```ts
// Input
{
  to?: string | string[];     // Required unless raw provided
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  threadId?: string;          // For replies
  inReplyTo?: string;         // Message-ID for threading
  raw?: string;               // base64url RFC 2822
}

// Output
{
  draft: { id, messageId?, threadId?, snippet? },
  meta?: { nextSteps?, relatedTools? }
}
```

### `update_draft`

Replace a draft's content (Gmail drafts are immutable internally).

```ts
// Input
{
  draftId: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  threadId?: string;
  raw?: string;
}
```

### `send_draft`

Send a draft. Optionally update it before sending.

```ts
// Input
{
  draftId: string;
  to?: string | string[];     // Override before send
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  threadId?: string;
  raw?: string;
}

// Output
{
  sent: { id, threadId?, labelIds?, snippet?, webUrl? },
  meta?: { nextSteps?, relatedTools? }
}
```

---

## Examples

### 1. Get inbox summary

```json
{ "name": "inbox_overview", "arguments": { "days": 7 } }
```

**Response:**
```
Inbox (last 7 days): 42 unread, 156 inbox, 12 sent, 3 starred

Recent unread:
  Alice: Meeting tomorrow at 3pm
  GitHub: PR merged in project-x

Starred:
  Boss: Q4 Planning document
```

### 2. Search for unread emails from a sender

```json
{
  "name": "search_threads",
  "arguments": {
    "query": "from:alice@example.com is:unread newer_than:7d",
    "limit": 10
  }
}
```

### 3. Read a thread

```json
{
  "name": "get_thread",
  "arguments": {
    "threadId": "19be18067165251d",
    "format": "full"
  }
}
```

### 4. Archive multiple threads

```json
{
  "name": "modify_thread",
  "arguments": {
    "threadIds": ["19be18067165251d", "19be17f8a2c3b4d5"],
    "actions": { "archive": true, "markRead": true }
  }
}
```

**Response:**
```
Modified 2/2 threads. -INBOX -UNREAD
```

### 5. Reply to a thread (draft first)

```json
{
  "name": "create_draft",
  "arguments": {
    "threadId": "19be18067165251d",
    "to": "alice@example.com",
    "text": "Thanks, I'll be there!"
  }
}
```

```json
{
  "name": "send_draft",
  "arguments": { "draftId": "r8651610029774" }
}
```

---

## HTTP Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mcp` | POST | MCP JSON-RPC 2.0 |
| `/mcp` | GET / DELETE | `405` (MCP protocol sessions are not used) |
| `/health` | GET | Health check |
| `/.well-known/oauth-authorization-server` | GET | OAuth AS metadata |
| `/.well-known/oauth-protected-resource/mcp` | GET | RFC 9728 OAuth protected-resource metadata |
| `/.well-known/oauth-protected-resource` | GET | Backward-compatible OAuth RS metadata alias |
| `/.well-known/oauth-authorization-server` | GET | OAuth authorization-server metadata |

OAuth proxy (`PORT + 1` on Bun; same origin on Workers):
- `GET /authorize` — Start OAuth flow
- `GET /oauth/callback` — Provider callback
- `POST /token` — Token exchange
- `POST /revoke` — Revoke tokens

---

## Development

```bash
bun dev                     # Bun MCP + OAuth proxy
bun run typecheck           # Bun and Worker TypeScript checks
bun run test                # Protocol, OAuth, provider, and storage tests
bun run lint                # Biome check
bun run format:check        # Formatting check
bun run build               # Bun bundle
bun run build:worker        # Wrangler dry-run bundle
bun run types:worker:check  # Generated binding type check
bun start                   # Run Bun production entry
```

For an actual local workerd protocol check, start `wrangler.test.jsonc` and run the official-client probe in another terminal:

```bash
bunx wrangler dev --config wrangler.test.jsonc --env-file wrangler.types.env
bun run test:workerd-client
```

---

## Architecture

```
src/
├── shared/
│   ├── tools/
│   │   └── gmail/           # Gmail tools shared by Bun and Workers
│   │       ├── get-profile.ts
│   │       ├── inbox-overview.ts
│   │       ├── list-labels.ts
│   │       ├── search-threads.ts
│   │       ├── get-thread.ts
│   │       ├── get-message.ts
│   │       ├── modify-thread.ts
│   │       ├── create-draft.ts
│   │       ├── update-draft.ts
│   │       └── send-draft.ts
│   ├── oauth/               # OAuth flow (PKCE, discovery)
│   └── storage/             # Token storage (file, KV, memory)
├── core/                    # Fresh-server MCP v2 factory/runtime
├── http/                    # Fetch-native security, auth gate, and routing
├── services/
│   └── gmail.ts             # Unchanged Gmail API client behavior
├── schemas/                 # Complete Zod 4 input/output schemas
├── index.ts                 # Bun dual-port entry
└── worker.ts                # Workers entry
```

---

## Candidate status, storage compatibility, and rollback

- Candidate baseline: protocol `2026-07-28`, server/client `2.0.0-beta.5`, Zod 4. This is not the final-release gate.
- Pre-migration repository baseline: `48d4ca49f3dba5621bb739608bcb2e483f1c14d6`.
- `FileTokenStore` remains version 1 and reads the existing plaintext or whole-file AES-256-GCM representation.
- Worker KV keys and values are unchanged: `rs:access:*`, `rs:refresh:*`, `txn:*`, `code:*`, and `session:*`; optional AES-GCM wrapping is unchanged.
- No migration rewrites, deletes, or invalidates provider refresh tokens or OAuth records; existing FileTokenStore expiry and provider-refresh behavior is preserved.
- Roll back application code by redeploying the recorded baseline (or reverting the migration changes) without clearing `.data`, KV, MCP resource tokens, or Google refresh tokens. Both versions can read the same stored records.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Unauthorized" | Complete OAuth flow again; refresh token may be revoked. |
| "Invalid Credentials" | Ensure OAUTH_SCOPES match your Google app and user consent. |
| "Insufficient Permission" | Add `gmail.modify` scope for `modify_thread`. |
| "Rate Limit Exceeded" | Slow down requests; use smaller limits. |
| "Thread not found" | Thread IDs expire; search again to get fresh IDs. |
| Draft update fails | Drafts are immutable; updates replace the underlying message. |
| OAuth does not start (Worker) | `curl -i -X POST https://<worker>/mcp` should return 401 with `WWW-Authenticate`. |
| Empty search results | Check query syntax; use `list_labels` to verify label IDs. |
| KV namespace error | Run `wrangler kv namespace create TOKENS` and update `wrangler.jsonc`. |

---

## License

MIT
