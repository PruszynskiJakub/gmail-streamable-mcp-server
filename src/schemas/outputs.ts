import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Meta + Pagination
// ─────────────────────────────────────────────────────────────────────────────

export const MetaSchema = z
  .object({
    nextSteps: z
      .array(z.string())
      .optional()
      .describe('Actionable follow-ups based on the current result.'),
    hints: z
      .array(z.string())
      .optional()
      .describe('Helpful tips to refine queries or recover from errors.'),
    relatedTools: z
      .array(z.string())
      .optional()
      .describe('Tool names that commonly follow this call.'),
  })
  .strict();

export const PaginationSchema = z
  .object({
    hasMore: z.boolean().describe('True when another page is available.'),
    nextCursor: z.string().optional().describe('Pass to cursor for the next page.'),
    itemsReturned: z.number().describe('Number of items returned in this page.'),
    limit: z.number().describe('Max items requested per page.'),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

export const LabelItemSchema = z
  .object({
    id: z.string().describe('Label id used in search filters.'),
    name: z.string().describe('Human-readable label name.'),
    type: z.string().optional().describe('Label type (system or user).'),
    messageListVisibility: z.string().optional(),
    labelListVisibility: z.string().optional(),
    messagesTotal: z.number().optional().describe('Total messages with this label.'),
    messagesUnread: z.number().optional().describe('Unread messages with this label.'),
    threadsTotal: z.number().optional().describe('Total threads with this label.'),
    threadsUnread: z.number().optional().describe('Unread threads with this label.'),
    color: z
      .object({
        textColor: z.string().optional(),
        backgroundColor: z.string().optional(),
      })
      .optional(),
  })
  .strict();
export type LabelItem = z.infer<typeof LabelItemSchema>;

export const ListLabelsOutputSchema = z
  .object({
    items: z.array(LabelItemSchema),
    meta: MetaSchema.optional(),
  })
  .strict();
export type ListLabelsOutput = z.infer<typeof ListLabelsOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Messages + Threads
// ─────────────────────────────────────────────────────────────────────────────

export const MessageHeaderSchema = z
  .object({
    subject: z.string().optional().describe('Email subject line.'),
    from: z.string().optional().describe('From header.'),
    to: z.string().optional().describe('To header.'),
    cc: z.string().optional().describe('Cc header.'),
    bcc: z.string().optional().describe('Bcc header.'),
    replyTo: z.string().optional().describe('Reply-To header.'),
    date: z.string().optional().describe('Date header.'),
    messageId: z.string().optional().describe('Message-Id header value.'),
    inReplyTo: z.string().optional().describe('In-Reply-To header value.'),
    references: z.string().optional().describe('References header value.'),
  })
  .strict();

export const MessageBodySchema = z
  .object({
    text: z.string().optional().describe('Plain text body if requested.'),
    html: z.string().optional().describe('HTML body if requested.'),
    raw: z.string().optional().describe('Raw RFC 2822 message if requested.'),
  })
  .strict();

export const MessageItemSchema = z
  .object({
    id: z.string().describe('Gmail message id.'),
    threadId: z.string().optional().describe('Gmail thread id.'),
    historyId: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
    snippet: z.string().optional().describe('Short preview snippet.'),
    internalDate: z.string().optional(),
    sizeEstimate: z.number().optional(),
    webUrl: z
      .string()
      .url()
      .optional()
      .describe('Gmail web link for this message/thread.'),
    headers: MessageHeaderSchema.optional(),
    rawHeaders: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: MessageBodySchema.optional(),
  })
  .strict();
export type MessageItem = z.infer<typeof MessageItemSchema>;

export const ThreadListItemSchema = z
  .object({
    id: z.string().describe('Gmail thread id (use as threadId for replies).'),
    subject: z.string().optional().describe('Email subject line.'),
    from: z.string().optional().describe('Sender display name.'),
    email: z.string().optional().describe('Sender email address (use for replies).'),
    date: z.string().optional().describe('Date of the most recent message.'),
    internalDate: z
      .string()
      .optional()
      .describe('Gmail internal date (ms since epoch) of the most recent message.'),
    snippet: z.string().optional().describe('Short preview snippet.'),
    messageCount: z.number().optional().describe('Number of messages in thread.'),
    isUnread: z
      .boolean()
      .optional()
      .describe('Whether the thread has unread messages.'),
    labelIds: z
      .array(z.string())
      .optional()
      .describe('Union of label ids across messages in the thread.'),
    labelNames: z
      .array(z.string())
      .optional()
      .describe('Resolved label names for labelIds.'),
    webUrl: z.string().url().optional().describe('Gmail web link for this thread.'),
  })
  .strict();
export type ThreadListItem = z.infer<typeof ThreadListItemSchema>;

export const SearchThreadsQuerySchema = z
  .object({
    query: z.string().optional().describe('Gmail search query string.'),
    labelIds: z.array(z.string()).optional().describe('Label ids used as filters.'),
    includeSpamTrash: z
      .boolean()
      .optional()
      .describe('Whether spam/trash are included.'),
    limit: z.number().optional().describe('Max results per page.'),
  })
  .strict();

export const SearchThreadsOutputSchema = z
  .object({
    query: SearchThreadsQuerySchema.optional(),
    items: z.array(ThreadListItemSchema),
    pagination: PaginationSchema.optional(),
    meta: MetaSchema.optional(),
  })
  .strict();
export type SearchThreadsOutput = z.infer<typeof SearchThreadsOutputSchema>;

export const ThreadDetailSchema = z
  .object({
    id: z.string().describe('Gmail thread id.'),
    historyId: z.string().optional(),
    messageCount: z.number().describe('Number of messages in this thread.'),
    labelIds: z.array(z.string()).optional(),
    webUrl: z.string().url().optional().describe('Gmail web link for this thread.'),
    messages: z.array(MessageItemSchema),
  })
  .strict();
export type ThreadDetail = z.infer<typeof ThreadDetailSchema>;

export const GetThreadOutputSchema = z
  .object({
    thread: ThreadDetailSchema,
    meta: MetaSchema.optional(),
  })
  .strict();
export type GetThreadOutput = z.infer<typeof GetThreadOutputSchema>;

export const GetMessageOutputSchema = z
  .object({
    message: MessageItemSchema,
    meta: MetaSchema.optional(),
  })
  .strict();
export type GetMessageOutput = z.infer<typeof GetMessageOutputSchema>;

export const ModifyThreadResultSchema = z
  .object({
    threadId: z.string().describe('Gmail thread id.'),
    success: z.boolean().describe('Whether the modification succeeded.'),
    error: z.string().optional().describe('Error message if failed.'),
  })
  .strict();

export const ModifyThreadOutputSchema = z
  .object({
    results: z.array(ModifyThreadResultSchema).describe('Results for each thread.'),
    summary: z
      .object({
        total: z.number().describe('Total threads processed.'),
        succeeded: z.number().describe('Threads successfully modified.'),
        failed: z.number().describe('Threads that failed.'),
      })
      .strict(),
    applied: z
      .object({
        addLabelIds: z.array(z.string()).optional(),
        removeLabelIds: z.array(z.string()).optional(),
      })
      .strict(),
    meta: MetaSchema.optional(),
  })
  .strict();
export type ModifyThreadOutput = z.infer<typeof ModifyThreadOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Drafts
// ─────────────────────────────────────────────────────────────────────────────

export const DraftItemSchema = z
  .object({
    id: z.string().describe('Gmail draft id.'),
    messageId: z.string().optional().describe('Underlying message id.'),
    threadId: z.string().optional().describe('Thread id if attached to a thread.'),
    snippet: z.string().optional().describe('Short preview snippet.'),
    labelIds: z.array(z.string()).optional(),
  })
  .strict();
export type DraftItem = z.infer<typeof DraftItemSchema>;

export const CreateDraftOutputSchema = z
  .object({
    draft: DraftItemSchema,
    meta: MetaSchema.optional(),
  })
  .strict();
export type CreateDraftOutput = z.infer<typeof CreateDraftOutputSchema>;

export const UpdateDraftOutputSchema = CreateDraftOutputSchema;
export type UpdateDraftOutput = z.infer<typeof UpdateDraftOutputSchema>;

export const SendDraftOutputSchema = z
  .object({
    sent: MessageItemSchema,
    meta: MetaSchema.optional(),
  })
  .strict();
export type SendDraftOutput = z.infer<typeof SendDraftOutputSchema>;
