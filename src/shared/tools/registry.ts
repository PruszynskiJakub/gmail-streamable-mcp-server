import {
  createDraftTool,
  getMessageTool,
  getProfileTool,
  getThreadTool,
  inboxOverviewTool,
  listLabelsTool,
  modifyThreadTool,
  searchThreadsTool,
  sendDraftTool,
  updateDraftTool,
} from './gmail/index.js';
import type { ToolContext, ToolResult } from './types.js';

export type { SharedToolDefinition, ToolContext, ToolResult } from './types.js';
export { defineTool } from './types.js';

/** Deterministic public contract shared by Bun and Workers. */
export const sharedTools = [
  getProfileTool,
  inboxOverviewTool,
  listLabelsTool,
  modifyThreadTool,
  searchThreadsTool,
  getThreadTool,
  getMessageTool,
  createDraftTool,
  updateDraftTool,
  sendDraftTool,
] as const;

export function getSharedTool(name: string): (typeof sharedTools)[number] | undefined {
  return sharedTools.find((tool) => tool.name === name);
}

export function getSharedToolNames(): string[] {
  return sharedTools.map((tool) => tool.name);
}

/** Direct execution seam used by provider-focused tests; MCP validation is SDK-owned. */
export async function executeSharedTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = getSharedTool(name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  if (context.signal?.aborted) {
    return {
      content: [{ type: 'text', text: 'Operation was cancelled' }],
      isError: true,
    };
  }

  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    return {
      content: [{ type: 'text', text: `Invalid input: ${errors}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(parsed.data as never, context);
    if (tool.outputSchema && !result.isError) {
      if (!result.structuredContent) {
        return {
          content: [
            {
              type: 'text',
              text: 'Tool with outputSchema must return structuredContent unless isError is true',
            },
          ],
          isError: true,
        };
      }
      const output = tool.outputSchema.safeParse(result.structuredContent);
      if (!output.success) {
        return {
          content: [
            { type: 'text', text: `Invalid tool output: ${output.error.message}` },
          ],
          isError: true,
        };
      }
    }
    return result;
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: context.signal?.aborted
            ? 'Operation was cancelled'
            : `Tool error: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
