import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { GmailClient, getAccessToken } from '../../../services/gmail.js';
import { truncate } from '../../../utils/formatting.js';
import {
  extractDisplayName,
  extractEmail,
  getGmailErrorHints,
  pickHeader,
} from '../../../utils/gmail.js';
import { formatErrorWithHints } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InboxOverviewInputSchema = z
  .object({
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe('Number of days to look back. Default: 7.'),
  })
  .strict();

const ThreadPreviewSchema = z.object({
  threadId: z.string().describe('Thread ID for replies/actions.'),
  subject: z.string().optional(),
  from: z.string().optional().describe('Sender display name.'),
  email: z.string().optional().describe('Sender email address for replies.'),
});

const InboxOverviewOutputSchema = z
  .object({
    account: z.string().email().describe('Connected Gmail account.'),
    period: z.string().describe('Time period covered (e.g., "last 7 days").'),
    counts: z
      .object({
        total: z.number().describe('All threads in the period.'),
        unread: z.number().describe('Unread threads in the period.'),
        inbox: z.number().describe('Inbox threads in the period.'),
        sent: z.number().describe('Sent threads in the period.'),
        starred: z.number().describe('Starred threads in the period.'),
        important: z.number().optional().describe('Important threads in the period.'),
      })
      .strict(),
    highlights: z
      .object({
        recentUnread: z
          .array(ThreadPreviewSchema)
          .optional()
          .describe('Most recent unread threads.'),
        starred: z
          .array(ThreadPreviewSchema)
          .optional()
          .describe('Starred threads in period.'),
      })
      .optional(),
    meta: z
      .object({
        nextSteps: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .strict();

export const inboxOverviewTool = defineTool({
  name: toolsMetadata.inbox_overview.name,
  title: toolsMetadata.inbox_overview.title,
  description: toolsMetadata.inbox_overview.description,
  inputSchema: InboxOverviewInputSchema,
  outputSchema: InboxOverviewOutputSchema.shape,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
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
    const days = args.days ?? 7;
    const baseQuery = `newer_than:${days}d`;
    const period = `last ${days} day${days === 1 ? '' : 's'}`;

    try {
      // Run count queries + fetch recent unread/starred for highlights + profile
      const [
        profile,
        totalResult,
        unreadResult,
        inboxResult,
        sentResult,
        starredResult,
        importantResult,
        recentUnreadList,
        starredList,
      ] = await Promise.all([
        client.getProfile(),
        client.listThreads({ q: baseQuery, maxResults: 1 }),
        client.listThreads({ q: `${baseQuery} is:unread`, maxResults: 1 }),
        client.listThreads({ q: baseQuery, labelIds: ['INBOX'], maxResults: 1 }),
        client.listThreads({ q: `${baseQuery} from:me`, maxResults: 1 }),
        client.listThreads({ q: `${baseQuery} is:starred`, maxResults: 1 }),
        client.listThreads({ q: `${baseQuery} is:important`, maxResults: 1 }),
        client.listThreads({ q: `${baseQuery} is:unread`, maxResults: 5 }),
        client.listThreads({ q: `${baseQuery} is:starred`, maxResults: 5 }),
      ]);

      const counts = {
        total: totalResult.resultSizeEstimate ?? 0,
        unread: unreadResult.resultSizeEstimate ?? 0,
        inbox: inboxResult.resultSizeEstimate ?? 0,
        sent: sentResult.resultSizeEstimate ?? 0,
        starred: starredResult.resultSizeEstimate ?? 0,
        important: (importantResult.resultSizeEstimate ?? 0) || undefined,
      };

      // Fetch metadata for highlight threads
      const fetchPreviews = async (threadIds: string[]) => {
        if (threadIds.length === 0) return [];
        const threads = await Promise.all(
          threadIds.slice(0, 5).map((id) =>
            client.getThread({
              id,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From'],
            }),
          ),
        );
        return threads.map((t) => {
          const first = t.messages?.[0];
          const headers = first?.payload?.headers;
          const fromHeader = pickHeader(headers, 'From');
          return {
            threadId: t.id,
            subject: pickHeader(headers, 'Subject'),
            from: extractDisplayName(fromHeader),
            email: extractEmail(fromHeader),
          };
        });
      };

      const [recentUnread, starredPreviews] = await Promise.all([
        fetchPreviews((recentUnreadList.threads ?? []).map((t) => t.id)),
        fetchPreviews((starredList.threads ?? []).map((t) => t.id)),
      ]);

      const highlights =
        recentUnread.length > 0 || starredPreviews.length > 0
          ? {
              recentUnread: recentUnread.length > 0 ? recentUnread : undefined,
              starred: starredPreviews.length > 0 ? starredPreviews : undefined,
            }
          : undefined;

      const nextSteps = [
        recentUnread.length > 0
          ? 'To reply: use threadId and email from highlights with create_draft.'
          : null,
        counts.unread > 0
          ? `search_threads query="${baseQuery} is:unread" to see all unread.`
          : null,
        counts.starred > 0 ? 'modify_thread to batch archive/star threads.' : null,
      ].filter(Boolean) as string[];

      const structured = InboxOverviewOutputSchema.parse({
        account: profile.emailAddress,
        period,
        counts,
        highlights,
        meta: nextSteps.length > 0 ? { nextSteps } : undefined,
      });

      // Build human-readable summary with threadId and email for actionability
      const lines: string[] = [
        `${profile.emailAddress} (${period}): ${counts.unread} unread, ${counts.inbox} inbox, ${counts.sent} sent, ${counts.starred} starred`,
      ];

      if (recentUnread.length > 0) {
        lines.push('', 'Recent unread:');
        for (const t of recentUnread) {
          const from = truncate(t.from ?? '?', 25);
          const subj = t.subject ? truncate(t.subject, 40) : '(no subject)';
          const email = t.email ? ` <${t.email}>` : '';
          lines.push(`  ${from}${email}: ${subj} [${t.threadId}]`);
        }
      }

      if (starredPreviews.length > 0) {
        lines.push('', 'Starred:');
        for (const t of starredPreviews) {
          const from = truncate(t.from ?? '?', 25);
          const subj = t.subject ? truncate(t.subject, 40) : '(no subject)';
          const email = t.email ? ` <${t.email}>` : '';
          lines.push(`  ${from}${email}: ${subj} [${t.threadId}]`);
        }
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = `Failed to get inbox overview: ${(error as Error).message}`;
      const hints = getGmailErrorHints(message);
      return {
        isError: true,
        content: [{ type: 'text', text: formatErrorWithHints(message, hints) }],
      };
    }
  },
});
