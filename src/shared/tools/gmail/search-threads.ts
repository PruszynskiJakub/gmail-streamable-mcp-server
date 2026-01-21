import { toolsMetadata } from '../../../config/metadata.js';
import { SearchThreadsInputSchema } from '../../../schemas/inputs.js';
import {
  SearchThreadsOutputSchema,
  type ThreadListItem,
} from '../../../schemas/outputs.js';
import { GmailClient, getAccessToken } from '../../../services/gmail.js';
import { truncate } from '../../../utils/formatting.js';
import {
  buildGmailThreadUrl,
  type GmailMessage,
  getGmailErrorHints,
  pickHeader,
} from '../../../utils/gmail.js';
import { formatErrorWithHints, summarizeList } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

/** Extract key metadata from the first message in a thread */
function extractThreadMetadata(
  messages: GmailMessage[] | undefined,
): Omit<ThreadListItem, 'id' | 'webUrl'> {
  const firstMsg = messages?.[0];
  const headers = firstMsg?.payload?.headers;
  const isUnread = Boolean(messages?.some((msg) => msg.labelIds?.includes('UNREAD')));

  return {
    subject: pickHeader(headers, 'Subject'),
    from: pickHeader(headers, 'From'),
    date: pickHeader(headers, 'Date'),
    snippet: firstMsg?.snippet,
    messageCount: messages?.length,
    isUnread,
  };
}

export const searchThreadsTool = defineTool({
  name: toolsMetadata.search_threads.name,
  title: toolsMetadata.search_threads.title,
  description: toolsMetadata.search_threads.description,
  inputSchema: SearchThreadsInputSchema,
  outputSchema: SearchThreadsOutputSchema.shape,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const token = getAccessToken(context);

    if (!token) {
      return {
        isError: true,
        content: [
          { type: 'text', text: 'Authentication required. Please sign in to Gmail.' },
        ],
      };
    }

    const client = new GmailClient(token);
    // Default to 25 to balance usefulness vs API calls
    const limit = args.limit ?? 25;

    try {
      // Step 1: Get messages (sorted by internalDate - truly chronological)
      // This ensures we find the newest MESSAGE, even if it's in an old thread
      const result = await client.listMessages({
        q: args.query,
        labelIds: args.labelIds,
        includeSpamTrash: args.includeSpamTrash,
        maxResults: limit,
        pageToken: args.cursor,
      });

      // Step 2: Extract unique threadIds preserving order (newest message first)
      const seenThreads = new Set<string>();
      const threadIds: string[] = [];
      for (const msg of result.messages ?? []) {
        if (!seenThreads.has(msg.threadId)) {
          seenThreads.add(msg.threadId);
          threadIds.push(msg.threadId);
        }
      }

      // Step 3: Fetch metadata for each thread in parallel
      const threadDetails = await Promise.all(
        threadIds.map((id) =>
          client.getThread({
            id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date'],
          }),
        ),
      );

      // Step 4: Build enriched items
      const items: ThreadListItem[] = threadDetails.map((thread) => ({
        id: thread.id,
        ...extractThreadMetadata(thread.messages),
        webUrl: buildGmailThreadUrl(thread.id),
      }));

      const nextCursor = result.nextPageToken;
      const pagination = {
        hasMore: Boolean(nextCursor),
        nextCursor,
        itemsReturned: items.length,
        limit,
      };

      const nextSteps = [
        ...(nextCursor
          ? [`Call again with cursor="${nextCursor}" to fetch more.`]
          : []),
        ...(items[0]?.id
          ? [`Use get_thread with threadId="${items[0].id}" to read full conversation.`]
          : []),
      ];

      const hints: string[] = [];

      const zeroReasonHints: string[] = [];
      if (items.length === 0) {
        if (args.labelIds?.length) {
          zeroReasonHints.push(
            'Verify labelIds with list_labels or remove label filters.',
          );
        }
        if (args.query) {
          zeroReasonHints.push('Try a simpler query or remove constraints.');
        } else {
          zeroReasonHints.push('Add a Gmail query like "from:someone is:unread".');
        }
        if (!args.includeSpamTrash) {
          zeroReasonHints.push('Set includeSpamTrash=true to broaden results.');
        }
      }

      const meta = {
        nextSteps,
        hints:
          zeroReasonHints.length > 0
            ? zeroReasonHints
            : hints.length > 0
              ? hints
              : undefined,
        relatedTools: ['get_thread', 'get_message', 'create_draft'],
      };

      const structured = SearchThreadsOutputSchema.parse({
        query: {
          query: args.query,
          labelIds: args.labelIds,
          includeSpamTrash: args.includeSpamTrash,
          limit,
        },
        items,
        pagination,
        meta,
      });

      // Build human-readable summary with actual useful info
      const previewLines = items.slice(0, 15).map((thread) => {
        const unread = thread.isUnread ? '[UNREAD] ' : '';
        const from = thread.from ? truncate(thread.from, 30) : '(unknown)';
        const subject = thread.subject ? truncate(thread.subject, 50) : '(no subject)';
        const count = thread.messageCount ? ` (${thread.messageCount})` : '';
        return `${unread}${from}: ${subject}${count} [${thread.id}]`;
      });

      const text = summarizeList({
        subject: 'Threads',
        count: items.length,
        limit,
        nextCursor,
        previewLines,
        zeroReasonHints,
        nextSteps,
      });

      return {
        content: [{ type: 'text', text }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = `Failed to search threads: ${(error as Error).message}`;
      const hints = getGmailErrorHints(message);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: formatErrorWithHints(message, hints),
          },
        ],
      };
    }
  },
});
