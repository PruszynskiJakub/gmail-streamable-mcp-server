import * as z from 'zod/v4';
import { strictSchema } from './common.js';

export const MessageFormatSchema = z
  .enum(['minimal', 'metadata', 'full', 'raw'])
  .describe(
    'Message format: minimal (ids + snippet), metadata (headers only), full (headers + body), raw (RFC 2822 base64url).',
  );

const AddressSchema = z
  .string()
  .min(1)
  .describe('Email address. Example: "alice@example.com".');

const AddressListSchema = z
  .union([AddressSchema, z.array(AddressSchema).min(1)])
  .describe('Single address or array of addresses.');

export const SearchThreadsInputSchema = strictSchema({
  query: z
    .string()
    .optional()
    .describe(
      'Gmail search query. Omit for newest threads (no filtering). Examples: "from:alice", "is:unread", "newer_than:7d".',
    ),
  labelIds: z
    .array(z.string())
    .optional()
    .describe('Filter threads by label IDs (from list_labels).'),
  includeSpamTrash: z
    .boolean()
    .optional()
    .describe('Include SPAM and TRASH in results. Default: false.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(
      'Max results (1-50). Default: 25. Use limit=1 with no query for single latest email.',
    ),
  cursor: z
    .string()
    .optional()
    .describe('Pagination cursor from previous response (nextPageToken).'),
});
export type SearchThreadsInput = z.infer<typeof SearchThreadsInputSchema>;

export const GetThreadInputSchema = strictSchema({
  threadId: z.string().min(1).describe('Thread ID to fetch.'),
  format: MessageFormatSchema.optional(),
  metadataHeaders: z
    .array(z.string())
    .optional()
    .describe('Specific headers to return (metadata format only).'),
  maxBodyChars: z
    .number()
    .int()
    .min(100)
    .max(200000)
    .optional()
    .describe('Max characters to return for message bodies. Default: 20000.'),
});
export type GetThreadInput = z.infer<typeof GetThreadInputSchema>;

export const GetMessageInputSchema = strictSchema({
  messageId: z.string().min(1).describe('Message ID to fetch.'),
  format: MessageFormatSchema.optional(),
  metadataHeaders: z
    .array(z.string())
    .optional()
    .describe('Specific headers to return (metadata format only).'),
  maxBodyChars: z
    .number()
    .int()
    .min(100)
    .max(200000)
    .optional()
    .describe('Max characters to return for the message body. Default: 20000.'),
});
export type GetMessageInput = z.infer<typeof GetMessageInputSchema>;

export const ListLabelsInputSchema = strictSchema({});
export type ListLabelsInput = z.infer<typeof ListLabelsInputSchema>;

const ThreadActionsSchema = z
  .object({
    archive: z.boolean().optional().describe('Remove INBOX label (archive).'),
    unarchive: z.boolean().optional().describe('Add INBOX label (move to inbox).'),
    markRead: z.boolean().optional().describe('Remove UNREAD label.'),
    markUnread: z.boolean().optional().describe('Add UNREAD label.'),
    star: z.boolean().optional().describe('Add STARRED label.'),
    unstar: z.boolean().optional().describe('Remove STARRED label.'),
    trash: z.boolean().optional().describe('Add TRASH label.'),
    untrash: z.boolean().optional().describe('Remove TRASH label.'),
    spam: z.boolean().optional().describe('Add SPAM label.'),
    unspam: z.boolean().optional().describe('Remove SPAM label.'),
  })
  .strict();

export const ModifyThreadInputSchema = strictSchema({
  threadIds: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .describe('Thread IDs to modify (batch supported, max 100).'),
  addLabelIds: z.array(z.string()).optional().describe('Label IDs to add.'),
  removeLabelIds: z.array(z.string()).optional().describe('Label IDs to remove.'),
  actions: ThreadActionsSchema.optional().describe(
    'Convenience actions for common labels.',
  ),
});
export type ModifyThreadInput = z.infer<typeof ModifyThreadInputSchema>;

export const ComposeFieldsSchema = z
  .object({
    from: AddressSchema.optional().describe('From address (optional).'),
    to: AddressListSchema.optional().describe('Primary recipients.'),
    cc: AddressListSchema.optional().describe('Cc recipients.'),
    bcc: AddressListSchema.optional().describe('Bcc recipients.'),
    replyTo: AddressListSchema.optional().describe('Reply-To address(es).'),
    subject: z.string().optional().describe('Email subject line.'),
    text: z.string().optional().describe('Plain text body.'),
    html: z.string().optional().describe('HTML body.'),
    inReplyTo: z
      .string()
      .optional()
      .describe('Message-ID of the email being replied to.'),
    references: z
      .array(z.string())
      .optional()
      .describe('List of Message-IDs for thread context.'),
    threadId: z
      .string()
      .optional()
      .describe('Gmail thread ID to attach the message to.'),
    raw: z.string().optional().describe('Raw RFC 2822 message encoded as base64url.'),
  })
  .strict();
export type ComposeFields = z.infer<typeof ComposeFieldsSchema>;

export const CreateDraftInputSchema = ComposeFieldsSchema.refine(
  (data) => {
    // Must have raw OR at least one recipient
    if (data.raw) return true;
    const hasRecipient = !!(data.to || data.cc || data.bcc);
    return hasRecipient;
  },
  { message: 'Provide raw RFC 2822 or at least one recipient (to, cc, or bcc).' },
);
export type CreateDraftInput = z.infer<typeof CreateDraftInputSchema>;

export const UpdateDraftInputSchema = ComposeFieldsSchema.extend({
  draftId: z.string().min(1).describe('Draft ID to update.'),
}).strict();
export type UpdateDraftInput = z.infer<typeof UpdateDraftInputSchema>;

export const SendDraftInputSchema = ComposeFieldsSchema.extend({
  draftId: z.string().min(1).describe('Draft ID to send.'),
}).strict();
export type SendDraftInput = z.infer<typeof SendDraftInputSchema>;
