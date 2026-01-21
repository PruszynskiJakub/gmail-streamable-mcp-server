import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toolsMetadata } from '../config/metadata.js';
import { strictSchema } from '../schemas/common.js';
import type { ExampleOutput } from '../schemas/outputs.js';
import type { RequestContext } from '../types/context.js';
import { CancellationError } from '../utils/cancellation.js';
import {
  createSection,
  formatKeyValueList,
  summarizeList,
} from '../utils/formatting.js';
import { logger } from '../utils/logger.js';

/**
 * Input schema for the example API tool.
 * Uses strict validation to reject unknown parameters.
 */
const ExampleApiInputSchema = strictSchema({
  query: z
    .string()
    .min(1, 'Query cannot be empty')
    .describe(
      'The search query to process. Be specific for better results. Example: "TypeScript best practices"',
    ),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(10)
    .describe(
      'Maximum number of results to return (1-100). Defaults to 10. Use smaller values for faster responses.',
    ),
  includeMetadata: z
    .boolean()
    .optional()
    .describe(
      'Include metadata like timestamps and confidence scores? Defaults to false.',
    ),
});

/**
 * Example API tool demonstrating production patterns:
 * - Uses centralized metadata from config/metadata.ts
 * - Strict input validation with safeParse
 * - Rich, LLM-friendly error messages
 * - Formatted output using formatting utilities
 * - Structured content alongside text
 * - Comprehensive logging
 */
export const exampleApiTool = {
  name: toolsMetadata.example_api.name,
  title: toolsMetadata.example_api.title,
  description: toolsMetadata.example_api.description,
  inputSchema: ExampleApiInputSchema.shape,
  handler: async (args: unknown, context?: RequestContext): Promise<CallToolResult> => {
    // Check for cancellation at the start
    try {
      context?.cancellationToken?.throwIfCancelled();
    } catch (error) {
      if (error instanceof CancellationError) {
        return {
          content: [
            {
              type: 'text',
              text: 'Operation was cancelled before starting.',
            },
          ],
          isError: true,
        };
      }
      throw error;
    }

    // Production pattern: Use safeParse for validation
    const parsed = ExampleApiInputSchema.safeParse(args);

    if (!parsed.success) {
      await logger.warning('example_api', {
        message: 'Invalid input parameters',
        errors: parsed.error.errors,
        requestId: context?.requestId,
      });

      // Return LLM-friendly error message
      const errorDetails = parsed.error.errors
        .map((err) => `- **${err.path.join('.')}**: ${err.message}`)
        .join('\n');

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `## ❌ Invalid Input Parameters

The following validation errors occurred:

${errorDetails}

**How to fix:**
1. Check that all required parameters are provided
2. Ensure parameter types match the schema (e.g., limit must be a number)
3. Verify values are within allowed ranges

**Need help?** Review the tool description for parameter details and examples.`,
          },
        ],
      };
    }

    const { query, limit, includeMetadata } = parsed.data;

    try {
      await logger.debug('example_api', {
        message: 'Example API call requested',
        query,
        limit,
        includeMetadata,
        requestId: context?.requestId,
      });

      // Check for cancellation before processing
      context?.cancellationToken?.throwIfCancelled();

      // Simulate API processing with some mock results
      const mockResults = generateMockResults(query, limit);

      // Check for cancellation after processing
      context?.cancellationToken?.throwIfCancelled();

      // Create structured output
      const result: ExampleOutput = {
        query,
        results: mockResults,
        count: mockResults.length,
        processed_at: new Date().toISOString(),
      };

      // Use formatting utilities for rich, LLM-friendly output
      const summaryText = summarizeList(mockResults, (r) => `- ${r}`, {
        title: `Search Results for "${query}"`,
        maxPreview: limit,
      });

      const textParts: string[] = [summaryText];

      // Add metadata section if requested
      if (includeMetadata) {
        const metadata = formatKeyValueList({
          'Total Results': result.count,
          Query: result.query,
          'Processed At': result.processed_at,
          'Response Time': '~50ms',
        });

        textParts.push('');
        textParts.push(createSection(metadata, { tag: 'metadata' }));
      }

      await logger.info('example_api', {
        message: 'Example API call completed',
        query,
        resultsCount: result.count,
        requestId: context?.requestId,
      });

      return {
        content: [
          {
            type: 'text',
            text: textParts.join('\n'),
          },
        ],
        structuredContent: result,
      };
    } catch (error) {
      // Handle cancellation gracefully
      if (error instanceof CancellationError) {
        await logger.info('example_api', {
          message: 'API call cancelled by user',
          query,
          requestId: context?.requestId,
        });
        return {
          content: [
            {
              type: 'text',
              text: `## 🚫 Operation Cancelled

The API call was cancelled before completion.

**Query**: "${query}"
**Status**: Cancelled by user request`,
            },
          ],
          isError: true,
        };
      }

      await logger.error('example_api', {
        message: 'API call failed',
        query,
        error: (error as Error).message,
        requestId: context?.requestId,
      });

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `## ❌ API Call Failed

**Error**: ${(error as Error).message}

**What happened:**
The API request could not be completed due to an unexpected error.

**Suggested actions:**
1. Verify the query format is correct
2. Check if the API service is available
3. Try again with a simpler query
4. Contact support if the issue persists

**Query attempted**: "${query}"`,
          },
        ],
      };
    }
  },
};

function generateMockResults(query: string, limit: number): string[] {
  // Generate mock results based on query
  const baseResults = [
    `${query} - Introduction`,
    `${query} - Advanced Guide`,
    `${query} - Best Practices`,
    `${query} - Examples`,
    `${query} - FAQ`,
    `${query} - API Reference`,
    `${query} - Tutorial`,
    `${query} - Case Study`,
    `${query} - Documentation`,
    `${query} - Community Discussion`,
  ];

  return baseResults.slice(0, Math.min(limit, baseResults.length));
}
