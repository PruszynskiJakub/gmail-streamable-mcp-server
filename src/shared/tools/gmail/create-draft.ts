import { toolsMetadata } from '../../../config/metadata.js';
import { CreateDraftInputSchema } from '../../../schemas/inputs.js';
import { CreateDraftOutputSchema } from '../../../schemas/outputs.js';
import { GmailClient, getAccessToken } from '../../../services/gmail.js';
import {
  type ComposeMessageInput,
  encodeMimeMessage,
  getGmailErrorHints,
  normalizeAddressList,
} from '../../../utils/gmail.js';
import { formatErrorWithHints } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

function buildRawDraft(args: {
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  raw?: string;
}): { raw?: string; error?: string } {
  if (args.raw && args.raw.trim().length > 0) {
    return { raw: args.raw.trim() };
  }

  const to = normalizeAddressList(args.to);
  const cc = normalizeAddressList(args.cc);
  const bcc = normalizeAddressList(args.bcc);
  const replyTo = normalizeAddressList(args.replyTo);
  const hasRecipients = to.length + cc.length + bcc.length > 0;

  if (!hasRecipients) {
    return { error: 'At least one recipient is required (to, cc, or bcc).' };
  }

  const input: ComposeMessageInput = {
    from: args.from,
    to,
    cc,
    bcc,
    replyTo,
    subject: args.subject,
    text: args.text,
    html: args.html,
    inReplyTo: args.inReplyTo,
    references: args.references,
  };

  return { raw: encodeMimeMessage(input) };
}

export const createDraftTool = defineTool({
  name: toolsMetadata.create_draft.name,
  title: toolsMetadata.create_draft.title,
  description: toolsMetadata.create_draft.description,
  inputSchema: CreateDraftInputSchema,
  outputSchema: CreateDraftOutputSchema.shape,
  annotations: {
    readOnlyHint: false,
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

    const { raw, error } = buildRawDraft(args);
    if (!raw) {
      const hint =
        'Provide raw RFC 2822 or at least one recipient with text/html content.';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: formatErrorWithHints(error ?? 'Draft content is required.', [hint]),
          },
        ],
      };
    }

    const client = new GmailClient(token);

    try {
      const result = await client.createDraft({
        raw,
        threadId: args.threadId,
      });

      const draft = {
        id: result.id,
        messageId: result.message?.id,
        threadId: result.message?.threadId,
        snippet: result.message?.snippet,
        labelIds: result.message?.labelIds,
      };

      const structured = CreateDraftOutputSchema.parse({
        draft,
        meta: {
          nextSteps: [
            'Use update_draft to modify the draft.',
            'Use send_draft to send it.',
          ],
          hints: [
            'Provide text and html to create a multipart/alternative email.',
            'Use threadId to keep the draft in the same conversation.',
          ],
          relatedTools: ['update_draft', 'send_draft'],
        },
      });

      const subject = args.subject ? `Subject: ${args.subject}` : 'Draft created.';
      const text = `${subject}\nDraft ID: ${draft.id}`;

      return {
        content: [{ type: 'text', text }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = `Failed to create draft: ${(error as Error).message}`;
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
