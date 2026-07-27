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
  extractDisplayName,
  extractEmail,
  type GmailMessage,
  getGmailErrorHints,
  pickHeader,
} from '../../../utils/gmail.js';
import { formatErrorWithHints, summarizeList } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

function getLatestMessage(
  messages: GmailMessage[] | undefined,
): GmailMessage | undefined {
  if (!messages || messages.length === 0) return undefined;
  return messages.reduce((latest, message) => {
    const latestTime = Number(latest.internalDate ?? Number.NEGATIVE_INFINITY);
    const messageTime = Number(message.internalDate ?? Number.NEGATIVE_INFINITY);
    return messageTime > latestTime ? message : latest;
  });
}

function collectLabelIds(messages: GmailMessage[] | undefined): string[] {
  const allLabelIds = messages?.flatMap((message) => message.labelIds ?? []) ?? [];
  return Array.from(new Set(allLabelIds));
}

function resolveLabelNames(
  labelIds: string[],
  labelNameById?: Map<string, string>,
): string[] | undefined {
  if (!labelNameById || labelIds.length === 0) return undefined;
  const names = labelIds.map((labelId) => labelNameById.get(labelId) ?? labelId);
  return names.length > 0 ? names : undefined;
}

function formatLabelPreview(thread: ThreadListItem): string {
  const labelIds = thread.labelIds ?? [];
  const labelNames = thread.labelNames ?? [];
  if (labelIds.length === 0 && labelNames.length === 0) return 'labels=none';
  const names = labelNames.length > 0 ? `labels=${labelNames.join(',')}` : undefined;
  const ids = labelIds.length > 0 ? `labelIds=${labelIds.join(',')}` : undefined;
  return [names, ids].filter(Boolean).join(' ');
}

/** Extract key metadata from the most recent message in a thread */
function extractThreadMetadata(
  messages: GmailMessage[] | undefined,
  labelNameById?: Map<string, string>,
): Omit<ThreadListItem, 'id' | 'webUrl'> {
  const latestMsg = getLatestMessage(messages);
  const headers = latestMsg?.payload?.headers;
  const isUnread = Boolean(messages?.some((msg) => msg.labelIds?.includes('UNREAD')));
  const fromHeader = pickHeader(headers, 'From');
  const labelIds = collectLabelIds(messages);
  const labelNames = resolveLabelNames(labelIds, labelNameById);

  return {
    subject: pickHeader(headers, 'Subject'),
    from: extractDisplayName(fromHeader) ?? fromHeader,
    email: extractEmail(fromHeader),
    date: pickHeader(headers, 'Date'),
    internalDate: latestMsg?.internalDate,
    snippet: latestMsg?.snippet,
    messageCount: messages?.length,
    isUnread,
    labelIds: labelIds.length > 0 ? labelIds : undefined,
    labelNames,
  };
}

export const searchThreadsTool = defineTool({
  name: toolsMetadata.search_threads.name,
  title: toolsMetadata.search_threads.title,
  description: toolsMetadata.search_threads.description,
  inputSchema: SearchThreadsInputSchema,
  outputSchema: SearchThreadsOutputSchema,
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

    const client = new GmailClient(token, context.signal);
    // Default to 25 to balance usefulness vs API calls
    const limit = args.limit ?? 25;

    try {
      const hints: string[] = [];
      let labelNameById: Map<string, string> | undefined;
      try {
        const { labels } = await client.listLabels();
        labelNameById = new Map(labels.map((label) => [label.id, label.name]));
      } catch {
        hints.push('Label names unavailable; use list_labels to resolve labelIds.');
      }

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
        ...extractThreadMetadata(thread.messages, labelNameById),
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

      // Build human-readable summary with threadId and email for actionability
      const previewLines = items.map((thread) => {
        const unread = thread.isUnread ? '[UNREAD] ' : '';
        const from = thread.from ? truncate(thread.from, 25) : '(unknown)';
        const email = thread.email ? ` <${truncate(thread.email, 25)}>` : '';
        const subject = thread.subject ? truncate(thread.subject, 40) : '(no subject)';
        const count = thread.messageCount ? ` (${thread.messageCount})` : '';
        const dateHeader = thread.date ? `date="${thread.date}"` : 'date=missing';
        const internalDate = thread.internalDate
          ? `internalDate=${thread.internalDate}`
          : 'internalDate=missing';
        const labels = formatLabelPreview(thread);
        return `${unread}${from}${email}: ${subject}${count} [${thread.id}] ${dateHeader} ${internalDate} ${labels}`;
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
