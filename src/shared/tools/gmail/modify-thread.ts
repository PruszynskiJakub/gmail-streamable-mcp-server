import { toolsMetadata } from '../../../config/metadata.js';
import { ModifyThreadInputSchema } from '../../../schemas/inputs.js';
import { ModifyThreadOutputSchema } from '../../../schemas/outputs.js';
import { GmailClient, getAccessToken } from '../../../services/gmail.js';
import { formatErrorWithHints } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

type LabelMapping = { add?: string[]; remove?: string[] };

const ACTION_LABELS: Record<string, LabelMapping> = {
  archive: { remove: ['INBOX'] },
  unarchive: { add: ['INBOX'] },
  markRead: { remove: ['UNREAD'] },
  markUnread: { add: ['UNREAD'] },
  star: { add: ['STARRED'] },
  unstar: { remove: ['STARRED'] },
  trash: { add: ['TRASH'] },
  untrash: { remove: ['TRASH'] },
  spam: { add: ['SPAM'] },
  unspam: { remove: ['SPAM'] },
};

const CONFLICTS: Array<[string, string]> = [
  ['archive', 'unarchive'],
  ['markRead', 'markUnread'],
  ['star', 'unstar'],
  ['trash', 'untrash'],
  ['spam', 'unspam'],
];

function buildLabelChanges(args: {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  actions?: Record<string, boolean | undefined>;
}): { addLabelIds: string[]; removeLabelIds: string[]; error?: string } {
  const add = new Set(args.addLabelIds ?? []);
  const remove = new Set(args.removeLabelIds ?? []);
  const actions = args.actions ?? {};

  const hasConflict = CONFLICTS.some(([a, b]) => actions[a] && actions[b]);
  if (hasConflict) {
    return {
      addLabelIds: [],
      removeLabelIds: [],
      error: 'Conflicting actions specified (e.g., archive and unarchive).',
    };
  }

  for (const [action, mapping] of Object.entries(ACTION_LABELS)) {
    if (!actions[action]) continue;
    mapping.add?.forEach((label) => add.add(label));
    mapping.remove?.forEach((label) => remove.add(label));
  }

  const overlap = Array.from(add).filter((label) => remove.has(label));
  if (overlap.length > 0) {
    return {
      addLabelIds: [],
      removeLabelIds: [],
      error: `Conflicting label operations for: ${overlap.join(', ')}.`,
    };
  }

  const addLabelIds = Array.from(add);
  const removeLabelIds = Array.from(remove);

  if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
    return {
      addLabelIds,
      removeLabelIds,
      error: 'No label changes provided.',
    };
  }

  return { addLabelIds, removeLabelIds };
}

export const modifyThreadTool = defineTool({
  name: toolsMetadata.modify_thread.name,
  title: toolsMetadata.modify_thread.title,
  description: toolsMetadata.modify_thread.description,
  inputSchema: ModifyThreadInputSchema,
  outputSchema: ModifyThreadOutputSchema.shape,
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

    const { addLabelIds, removeLabelIds, error } = buildLabelChanges({
      addLabelIds: args.addLabelIds,
      removeLabelIds: args.removeLabelIds,
      actions: args.actions,
    });

    if (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: formatErrorWithHints(error, [
              'Use actions for common tasks (archive, markRead, star) or provide addLabelIds/removeLabelIds.',
              'Call list_labels to discover custom label ids.',
            ]),
          },
        ],
      };
    }

    const client = new GmailClient(token);
    const threadIds = args.threadIds;

    // Process all threads in parallel
    const results = await Promise.all(
      threadIds.map(async (threadId) => {
        try {
          await client.modifyThread({ threadId, addLabelIds, removeLabelIds });
          return { threadId, success: true };
        } catch (err) {
          return { threadId, success: false, error: (err as Error).message };
        }
      }),
    );

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const structured = ModifyThreadOutputSchema.parse({
      results,
      summary: {
        total: threadIds.length,
        succeeded,
        failed,
      },
      applied: {
        addLabelIds: addLabelIds.length > 0 ? addLabelIds : undefined,
        removeLabelIds: removeLabelIds.length > 0 ? removeLabelIds : undefined,
      },
      meta: {
        nextSteps:
          failed > 0 ? ['Retry failed threads or check thread IDs.'] : undefined,
        relatedTools: ['search_threads', 'list_labels'],
      },
    });

    const added = addLabelIds.length ? `+${addLabelIds.join(',')}` : '';
    const removed = removeLabelIds.length ? `-${removeLabelIds.join(',')}` : '';
    const ops = [added, removed].filter(Boolean).join(' ');

    const lines = [`Modified ${succeeded}/${threadIds.length} threads. ${ops}`];

    // Show errors for failed threads
    const failedResults = results.filter((r) => !r.success);
    if (failedResults.length > 0) {
      for (const r of failedResults) {
        lines.push(`  - ${r.threadId}: ${r.error ?? 'Unknown error'}`);
      }
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  },
});
