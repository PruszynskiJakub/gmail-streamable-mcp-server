import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { GmailClient, getAccessToken } from '../../../services/gmail.js';
import { getGmailErrorHints } from '../../../utils/gmail.js';
import { formatErrorWithHints } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const GetProfileInputSchema = z.object({}).strict();

const GetProfileOutputSchema = z
  .object({
    email: z.string().email().describe('The connected Gmail account email.'),
  })
  .strict();

export const getProfileTool = defineTool({
  name: toolsMetadata.get_profile.name,
  title: toolsMetadata.get_profile.title,
  description: toolsMetadata.get_profile.description,
  inputSchema: GetProfileInputSchema,
  outputSchema: GetProfileOutputSchema.shape,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
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

    const client = new GmailClient(token);

    try {
      const profile = await client.getProfile();

      const structured = GetProfileOutputSchema.parse({
        email: profile.emailAddress,
      });

      return {
        content: [{ type: 'text', text: `Connected as ${profile.emailAddress}` }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = `Failed to get profile: ${(error as Error).message}`;
      const hints = getGmailErrorHints(message);
      return {
        isError: true,
        content: [{ type: 'text', text: formatErrorWithHints(message, hints) }],
      };
    }
  },
});
