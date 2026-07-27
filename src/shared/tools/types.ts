import type { AuthInfo, CallToolResult } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';

export type AuthStrategy = 'oauth' | 'bearer' | 'api_key' | 'custom' | 'none';

/** Request-local values exposed to Gmail tool handlers. */
export interface ToolContext {
  signal?: AbortSignal;
  meta?: {
    progressToken?: string | number;
    requestId?: string;
  };
  authStrategy?: AuthStrategy;
  /** Deliberately resolved provider credential; never the inbound MCP bearer. */
  providerToken?: string;
  /** Validated MCP principal metadata, without provider refresh credentials. */
  authInfo?: Pick<AuthInfo, 'clientId' | 'scopes' | 'expiresAt' | 'resource'>;
}

export type ToolResult = CallToolResult;

export interface SharedToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType | undefined = z.ZodType | undefined,
> {
  name: string;
  title?: string;
  description: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  handler: (args: z.output<TInput>, context: ToolContext) => Promise<ToolResult>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export function defineTool<
  TInput extends z.ZodType,
  TOutput extends z.ZodType | undefined = undefined,
>(
  definition: SharedToolDefinition<TInput, TOutput>,
): SharedToolDefinition<TInput, TOutput> {
  return definition;
}
