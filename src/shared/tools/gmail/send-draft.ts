import { toolsMetadata } from '../../../config/metadata.js';
import { SendDraftInputSchema } from '../../../schemas/inputs.js';
import { SendDraftOutputSchema } from '../../../schemas/outputs.js';
import { GmailClient, getAccessToken } from '../../../services/gmail.js';
import {
  type ComposeMessageInput,
  encodeMimeMessage,
  getGmailErrorHints,
  normalizeAddressList,
  normalizeMessage,
} from '../../../utils/gmail.js';
import { formatErrorWithHints } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

function buildRawIfProvided(args: {
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
  const hasStructured =
    args.from ||
    args.to ||
    args.cc ||
    args.bcc ||
    args.replyTo ||
    args.subject ||
    args.text ||
    args.html ||
    args.inReplyTo ||
    (args.references && args.references.length > 0);

  if (args.raw && args.raw.trim().length > 0) {
    return { raw: args.raw.trim() };
  }

  if (!hasStructured) {
    return {};
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

export const sendDraftTool = defineTool({
  name: toolsMetadata.send_draft.name,
  title: toolsMetadata.send_draft.title,
  description: toolsMetadata.send_draft.description,
  inputSchema: SendDraftInputSchema,
  outputSchema: SendDraftOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
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

    const rawResult = buildRawIfProvided(args);
    if (rawResult.error) {
      const hint =
        'If updating before send, include raw RFC 2822 or at least one recipient with text/html content.';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: formatErrorWithHints(rawResult.error, [hint]),
          },
        ],
      };
    }

    const client = new GmailClient(token, context.signal);

    try {
      const message = await client.sendDraft({
        draftId: args.draftId,
        raw: rawResult.raw,
        threadId: args.threadId,
      });

      const normalized = normalizeMessage(message, { includeBody: false });
      const nextSteps = normalized.threadId
        ? [`Use get_thread with threadId="${normalized.threadId}".`]
        : ['Use get_thread to verify the sent message in the thread.'];
      const structured = SendDraftOutputSchema.parse({
        sent: normalized,
        meta: {
          nextSteps,
          hints: ['Sending deletes the draft and creates a new SENT message.'],
          relatedTools: ['get_thread', 'search_threads'],
        },
      });

      const subject = normalized.headers?.subject ?? '(no subject)';
      const text = `Draft sent.\nMessage ID: ${normalized.id}\nSubject: ${subject}`;

      return {
        content: [{ type: 'text', text }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = `Failed to send draft: ${(error as Error).message}`;
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
