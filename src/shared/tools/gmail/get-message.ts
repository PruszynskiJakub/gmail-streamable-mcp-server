import { toolsMetadata } from '../../../config/metadata.js';
import { GetMessageInputSchema } from '../../../schemas/inputs.js';
import { GetMessageOutputSchema } from '../../../schemas/outputs.js';
import { GmailClient, getAccessToken } from '../../../services/gmail.js';
import { getGmailErrorHints, normalizeMessage } from '../../../utils/gmail.js';
import { formatErrorWithHints } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

export const getMessageTool = defineTool({
  name: toolsMetadata.get_message.name,
  title: toolsMetadata.get_message.title,
  description: toolsMetadata.get_message.description,
  inputSchema: GetMessageInputSchema,
  outputSchema: GetMessageOutputSchema.shape,
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
    const format = args.format ?? 'metadata';
    const maxBodyChars = args.maxBodyChars ?? 20000;

    try {
      const message = await client.getMessage({
        id: args.messageId,
        format,
        metadataHeaders: args.metadataHeaders,
      });

      const includeBody = format === 'full';
      const includeRaw = format === 'raw';
      const normalized = normalizeMessage(message, {
        includeBody,
        includeRaw,
        maxBodyChars,
      });

      const nextSteps = normalized.threadId
        ? [`Use get_thread with threadId="${normalized.threadId}".`]
        : ['Use get_thread to read the full conversation.'];
      const hints = [
        'Use format="full" to include bodies, or format="metadata" for headers only.',
        'Use metadataHeaders to return a subset of headers.',
        'Use maxBodyChars to cap large bodies when format="full".',
      ];

      const structured = GetMessageOutputSchema.parse({
        message: normalized,
        meta: {
          nextSteps,
          hints,
          relatedTools: ['search_threads', 'get_thread'],
        },
      });

      const subject = normalized.headers?.subject ?? '(no subject)';
      const from = normalized.headers?.from ?? '(unknown sender)';
      const snippet = normalized.snippet ?? '';
      const text = `Message ${normalized.id}: ${subject} - ${from}${snippet ? `\n${snippet}` : ''}`;

      return {
        content: [{ type: 'text', text }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = `Failed to get message: ${(error as Error).message}`;
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
