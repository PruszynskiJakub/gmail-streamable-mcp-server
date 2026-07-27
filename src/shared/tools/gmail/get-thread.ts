import { toolsMetadata } from '../../../config/metadata.js';
import { GetThreadInputSchema } from '../../../schemas/inputs.js';
import { GetThreadOutputSchema } from '../../../schemas/outputs.js';
import { GmailClient, getAccessToken } from '../../../services/gmail.js';
import {
  buildGmailThreadUrl,
  getGmailErrorHints,
  normalizeMessage,
} from '../../../utils/gmail.js';
import { formatErrorWithHints, summarizeList } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

export const getThreadTool = defineTool({
  name: toolsMetadata.get_thread.name,
  title: toolsMetadata.get_thread.title,
  description: toolsMetadata.get_thread.description,
  inputSchema: GetThreadInputSchema,
  outputSchema: GetThreadOutputSchema,
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
    const format = args.format ?? 'metadata';
    const maxBodyChars = args.maxBodyChars ?? 20000;

    try {
      const thread = await client.getThread({
        id: args.threadId,
        format,
        metadataHeaders: args.metadataHeaders,
      });

      const includeBody = format === 'full';
      const includeRaw = format === 'raw';

      const messages = (thread.messages ?? []).map((message) =>
        normalizeMessage(message, { includeBody, includeRaw, maxBodyChars }),
      );

      const labelIds = Array.from(new Set(messages.flatMap((m) => m.labelIds ?? [])));

      const nextSteps = [
        ...(messages[0]?.id
          ? [`Use get_message with messageId="${messages[0].id}".`]
          : []),
        'Use search_threads to find related conversations.',
      ];

      const hints = [
        'Use format="full" to include bodies, or format="metadata" for headers only.',
        'Use metadataHeaders to return a subset of headers.',
        'Use maxBodyChars to cap large bodies when format="full".',
        'Web links use /u/0 by default; change the account index if needed.',
      ];

      const structured = GetThreadOutputSchema.parse({
        thread: {
          id: thread.id,
          historyId: thread.historyId,
          messageCount: messages.length,
          labelIds: labelIds.length > 0 ? labelIds : undefined,
          webUrl: buildGmailThreadUrl(thread.id),
          messages,
        },
        meta: {
          nextSteps,
          hints,
          relatedTools: ['get_message', 'search_threads', 'list_labels'],
        },
      });

      const previewLines = messages.slice(0, 5).map((msg) => {
        const subject = msg.headers?.subject ?? '(no subject)';
        const from = msg.headers?.from ?? '(unknown sender)';
        return `${msg.id}: ${subject} - ${from}`;
      });

      const text = summarizeList({
        subject: `Thread ${thread.id}`,
        count: messages.length,
        previewLines,
        nextSteps,
      });

      return {
        content: [{ type: 'text', text }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = `Failed to get thread: ${(error as Error).message}`;
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
