# Gmail MCP Server

Streamable HTTP MCP server for Gmail — search threads, read messages, manage drafts, and organize your inbox.

Author: [overment](https://x.com/_overment)

> [!WARNING]
> You connect this server to your MCP client at your own responsibility. Language models can make mistakes, misinterpret instructions, or perform unintended actions. Review tool outputs, verify results in Gmail, and prefer small, incremental writes.
>
> The HTTP/OAuth layer is designed for convenience during development, not production-grade security. If deploying remotely, harden it: proper token validation, secure storage, TLS termination, strict CORS/origin checks, rate limiting, audit logging, and compliance with Google OAuth policies.

## Notice

This repo works in two ways:
- As a **Node/Hono server** for local workflows
- As a **Cloudflare Worker** for remote interactions

For production Cloudflare deployments, see [Remote Model Context Protocol servers (MCP)](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp).

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
- ✅ **OAuth 2.1** — Secure PKCE flow with RS token mapping
- ✅ **Dual Runtime** — Node.js/Bun or Cloudflare Workers

### Design Principles

- **LLM-friendly**: Tools are simplified, not 1:1 Gmail API mirrors
- **Discovery-first**: `inbox_overview` and `list_labels` help avoid guessing
- **Batch-first**: `modify_thread` accepts arrays to minimize tool calls
- **Safer writes**: Drafts first, send explicitly
- **Clear feedback**: Summaries with structured content and next steps

---

## Installation

Prerequisites: [Bun](https://bun.sh/), Node.js 24+, a Google account, and a Gmail-enabled Google Cloud project. For remote: a [Cloudflare](https://dash.cloudflare.com) account.

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

```bash
bun x wrangler secret put PROVIDER_CLIENT_ID
bun x wrangler secret put PROVIDER_CLIENT_SECRET
bun x wrangler dev --local | cat
```

Endpoint: `http://127.0.0.1:8787/mcp`

---

### 3. Cloudflare Worker (Deploy)

1. Create KV namespace:

```bash
bun x wrangler kv:namespace create TOKENS
```

2. Update `wrangler.toml` with KV namespace ID

3. Set secrets:

```bash
bun x wrangler secret put PROVIDER_CLIENT_ID
bun x wrangler secret put PROVIDER_CLIENT_SECRET

# Generate encryption key (32-byte base64url):
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
bun x wrangler secret put RS_TOKENS_ENC_KEY
```

> **Note:** `RS_TOKENS_ENC_KEY` encrypts OAuth tokens stored in KV (AES-256-GCM).

4. Update redirect URI and allowlist in `wrangler.toml`

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
| `/mcp` | GET | SSE stream (Node.js only) |
| `/health` | GET | Health check |
| `/.well-known/oauth-authorization-server` | GET | OAuth AS metadata |
| `/.well-known/oauth-protected-resource` | GET | OAuth RS metadata |

OAuth (PORT+1 for Node):
- `GET /authorize` — Start OAuth flow
- `GET /oauth/callback` — Provider callback
- `POST /token` — Token exchange
- `POST /revoke` — Revoke tokens

---

## Development

```bash
bun dev           # Start with hot reload
bun run typecheck # TypeScript check
bun run lint      # Lint code
bun run build     # Production build
bun start         # Run production
```

---

## Architecture

```
src/
├── shared/
│   ├── tools/
│   │   └── gmail/           # Gmail tools (shared for Node + Workers)
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
├── services/
│   └── gmail.ts             # Gmail API client
├── schemas/
│   ├── inputs.ts            # Zod input schemas
│   └── outputs.ts           # Zod output schemas
├── config/
│   └── metadata.ts          # Server + tool descriptions
├── index.ts                 # Node.js entry
└── worker.ts                # Workers entry
```

---

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
| KV namespace error | Run `wrangler kv:namespace create TOKENS` and update wrangler.toml. |

---

## License

MIT
