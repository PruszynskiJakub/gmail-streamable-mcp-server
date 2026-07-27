import { toolsMetadata } from '../../../config/metadata.js';
import { ListLabelsInputSchema } from '../../../schemas/inputs.js';
import { ListLabelsOutputSchema } from '../../../schemas/outputs.js';
import { GmailClient, getAccessToken } from '../../../services/gmail.js';
import { getGmailErrorHints } from '../../../utils/gmail.js';
import { formatErrorWithHints, summarizeList } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

export const listLabelsTool = defineTool({
  name: toolsMetadata.list_labels.name,
  title: toolsMetadata.list_labels.title,
  description: toolsMetadata.list_labels.description,
  inputSchema: ListLabelsInputSchema,
  outputSchema: ListLabelsOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (_args, context: ToolContext): Promise<ToolResult> => {
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

    try {
      const result = await client.listLabels();
      const items = (result.labels ?? []).map((label) => ({
        id: label.id,
        name: label.name,
        type: label.type,
        messageListVisibility: label.messageListVisibility,
        labelListVisibility: label.labelListVisibility,
        messagesTotal: label.messagesTotal,
        messagesUnread: label.messagesUnread,
        threadsTotal: label.threadsTotal,
        threadsUnread: label.threadsUnread,
        color: label.color,
      }));

      const meta = {
        nextSteps: [
          'Use search_threads with labelIds to filter by label.',
          'Use get_thread to read a specific conversation.',
        ],
        hints: ['Label ids are required when filtering by labels.'],
        relatedTools: ['search_threads', 'get_thread', 'get_message'],
      };

      const structured = ListLabelsOutputSchema.parse({ items, meta });

      const previewLines = items.map((label) => `${label.name} (${label.id})`);
      const text = summarizeList({
        subject: 'Labels',
        count: items.length,
        previewLines,
        nextSteps: meta.nextSteps,
        zeroReasonHints: ['Ensure the Gmail account is connected and has labels.'],
      });

      return {
        content: [{ type: 'text', text }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = `Failed to list labels: ${(error as Error).message}`;
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
