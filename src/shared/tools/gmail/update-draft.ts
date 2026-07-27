import { toolsMetadata } from '../../../config/metadata.js';
import { UpdateDraftInputSchema } from '../../../schemas/inputs.js';
import { UpdateDraftOutputSchema } from '../../../schemas/outputs.js';
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

export const updateDraftTool = defineTool({
  name: toolsMetadata.update_draft.name,
  title: toolsMetadata.update_draft.title,
  description: toolsMetadata.update_draft.description,
  inputSchema: UpdateDraftInputSchema,
  outputSchema: UpdateDraftOutputSchema,
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

    const client = new GmailClient(token, context.signal);

    try {
      const result = await client.updateDraft({
        draftId: args.draftId,
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

      const structured = UpdateDraftOutputSchema.parse({
        draft,
        meta: {
          nextSteps: ['Use send_draft to send the updated draft.'],
          hints: ['Updating a draft replaces its underlying message.'],
          relatedTools: ['send_draft', 'create_draft'],
        },
      });

      const text = `Draft updated.\nDraft ID: ${draft.id}`;

      return {
        content: [{ type: 'text', text }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = `Failed to update draft: ${(error as Error).message}`;
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
