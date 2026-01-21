/**
 * Centralized tool metadata for the Gmail MCP server.
 */
export interface ToolMetadata {
  name: string;
  title: string;
  description: string;
}

export const toolsMetadata = {
  get_profile: {
    name: 'get_profile',
    title: 'Get Profile',
    description:
      'Get the connected Gmail account email. Returns only the email address for identity confirmation.',
  },

  inbox_overview: {
    name: 'inbox_overview',
    title: 'Inbox Overview',
    description:
      'Get inbox stats + highlights for a time range (default: 7 days). Returns counts (unread, inbox, sent, starred, important) plus previews of recent unread and starred threads.',
  },

  modify_thread: {
    name: 'modify_thread',
    title: 'Modify Threads',
    description:
      'Batch add/remove labels on threads (up to 100). Actions: archive, star, markRead, trash, or raw label IDs.',
  },

  list_labels: {
    name: 'list_labels',
    title: 'List Labels',
    description:
      'List Gmail labels with ids, names, types, and counts. Use label ids with search_threads and other filters.',
  },

  search_threads: {
    name: 'search_threads',
    title: 'Search Threads',
    description:
      'Search threads by Gmail query and/or labelIds. Results ordered by newest MESSAGE (not thread creation). For latest email: use limit=1 with no query. Returns subject, sender, date, message count, unread status, and web links. Use get_thread to read full message bodies.',
  },

  get_thread: {
    name: 'get_thread',
    title: 'Get Thread',
    description:
      'Fetch a thread by id with ordered messages and a thread web link. Use format to control bodies, and message ids for get_message.',
  },

  get_message: {
    name: 'get_message',
    title: 'Get Message',
    description:
      'Fetch a single message by id. Use format to control headers/body and return a web link when available.',
  },

  create_draft: {
    name: 'create_draft',
    title: 'Create Draft',
    description:
      'Create a draft from structured fields or raw RFC 2822. Requires recipients if structured. Returns draft id and message metadata.',
  },

  update_draft: {
    name: 'update_draft',
    title: 'Update Draft',
    description:
      'Replace a draft message by draftId. Accepts raw or structured fields and returns updated draft metadata.',
  },

  send_draft: {
    name: 'send_draft',
    title: 'Send Draft',
    description:
      'Send a draft by draftId. Optionally replace contents before sending. Returns sent message metadata.',
  },
} as const satisfies Record<string, ToolMetadata>;

/**
 * Type-safe helper to get metadata for a tool.
 * Usage: getToolMetadata('example_api')
 */
export function getToolMetadata(toolName: keyof typeof toolsMetadata): ToolMetadata {
  return toolsMetadata[toolName];
}

/**
 * Get all registered tool names.
 */
export function getToolNames(): string[] {
  return Object.keys(toolsMetadata);
}

/**
 * Server-level metadata
 */
export const serverMetadata = {
  title: 'Gmail',
  instructions:
    'Start with inbox_overview to see connected account and stats. Use threadIds from search results for get_thread or modify_thread. For replies, create_draft with threadId. Batch operations supported (up to 100 threads).',
} as const;
