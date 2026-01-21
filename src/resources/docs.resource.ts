import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';

const documentationContent = `# MCP Server Template Documentation

This is the auto-generated documentation for your MCP Server Template.

## Overview

This server implements the Model Context Protocol (MCP) using Streamable HTTP transport with the following features:

- **Tools**: Extensible tool system with Zod validation
- **Prompts**: Dynamic prompt generation with pagination
- **Resources**: Static and templated resource access
- **Authentication**: Optional OAuth 2.1 with RFC9728/RFC8414 discovery
- **Logging**: Structured logging with MCP notifications
- **Security**: Origin validation, protocol version checks, token validation

## Available Tools

1. **get_profile** - Get connected Gmail account email
2. **inbox_overview** - Inbox stats + highlights for a time range
3. **list_labels** - List Gmail labels with IDs and counts
4. **search_threads** - Search threads with Gmail query syntax
5. **get_thread** - Get full thread conversation
6. **get_message** - Get single message details
7. **modify_thread** - Batch add/remove labels on threads
8. **create_draft** - Create a new draft
9. **update_draft** - Update an existing draft
10. **send_draft** - Send a draft

## Available Resources

1. **config://server** - Server configuration (redacted)
2. **docs://overview** - This documentation

## Authentication

When \`AUTH_ENABLED=true\`, the server implements OAuth 2.1 Resource Server functionality:

- Validates Bearer tokens on all requests
- Provides RFC9728 Protected Resource Metadata discovery
- Supports RFC8414 Authorization Server Metadata
- Enforces audience/resource parameter binding

## Development

Run the server in development mode:

\`\`\`bash
bun dev
\`\`\`

## Production

Build and run for production:

\`\`\`bash
bun build
bun start
\`\`\`

For more details, see the README.md file.
`;

export const docsResource = {
  uri: 'docs://overview',
  name: 'Server Documentation',
  description: 'Overview documentation for this MCP server',
  mimeType: 'text/markdown',

  handler: async (): Promise<ReadResourceResult> => {
    logger.debug('docs_resource', { message: 'Documentation requested' });

    return {
      contents: [
        {
          uri: 'docs://overview',
          name: 'overview.md',
          title: 'Server Documentation',
          mimeType: 'text/markdown',
          text: documentationContent,
          annotations: {
            audience: ['user', 'assistant'],
            priority: 0.8,
            lastModified: new Date().toISOString(),
          },
        },
      ],
    };
  },
};
