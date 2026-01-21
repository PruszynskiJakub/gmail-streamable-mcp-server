/**
 * Agentic research tool that uses sampling to perform multi-step analysis.
 * Demonstrates how servers can leverage client LLM access for complex tasks.
 */

import { z } from 'zod';
import type { RequestContext } from '../types/context.js';
import { logger } from '../utils/logger.js';
import { clientSupportsSampling, requestTextCompletion } from '../utils/sampling.js';
import { defineTool } from './tool-utils.js';

/**
 * Input schema for research tool.
 */
const ResearchInputSchema = z.object({
  topic: z.string().min(1).describe('Topic to research'),
  depth: z
    .enum(['quick', 'standard', 'comprehensive'])
    .optional()
    .default('standard')
    .describe('Research depth level'),
  format: z
    .enum(['summary', 'detailed', 'academic'])
    .optional()
    .default('summary')
    .describe('Output format'),
});

type ResearchInput = z.infer<typeof ResearchInputSchema>;

/**
 * Agentic research tool.
 *
 * This tool demonstrates sampling by:
 * 1. Breaking down the research task into steps
 * 2. Using LLM sampling for each step
 * 3. Synthesizing results into final output
 *
 * Flow:
 * - Tool is called by client LLM
 * - Tool requests sampling from client (asks client to call LLM)
 * - Client performs LLM calls and returns results
 * - Tool processes and returns to original LLM
 *
 * This creates a nested LLM interaction for agentic behaviors.
 */
export const researchTool = defineTool({
  name: 'research',
  description:
    'Perform multi-step research on a topic using agentic LLM sampling. Requires client sampling capability.',
  inputSchema: ResearchInputSchema,
  handler: async (
    { topic, depth = 'standard', format = 'summary' }: ResearchInput,
    context?: RequestContext,
  ) => {
    try {
      // Check if sampling is available
      const server = (context as { _server?: McpServer } | undefined)?._server;
      if (!server) {
        return {
          content: [
            {
              type: 'text',
              text: '## Sampling Unavailable\n\nServer context not available for sampling.',
            },
          ],
          isError: true,
        };
      }

      if (!clientSupportsSampling(server)) {
        return {
          content: [
            {
              type: 'text',
              text: '## Sampling Not Supported\n\nThis tool requires client sampling capability. The connected client does not support sampling.\n\nTo use this tool, ensure your MCP client declares the `sampling` capability during initialization.',
            },
          ],
          isError: true,
        };
      }

      logger.info('research_tool', {
        message: 'Starting agentic research',
        topic,
        depth,
        format,
      });

      const steps = depth === 'quick' ? 2 : depth === 'standard' ? 3 : 5;
      const results: string[] = [];

      // Step 1: Generate research questions
      logger.debug('research_tool', { message: 'Step 1: Generating questions' });
      const questions = await requestTextCompletion(
        server,
        `Generate ${steps} focused research questions about "${topic}". Return only the questions, numbered 1-${steps}.`,
        200,
        {
          modelPreferences: {
            hints: [{ name: 'claude' }],
            intelligencePriority: 0.7,
            speedPriority: 0.6,
          },
        },
      );
      results.push(`### Research Questions\n${questions}`);

      // Step 2: Answer each question (simplified - in production would iterate)
      logger.debug('research_tool', { message: 'Step 2: Answering questions' });
      const answers = await requestTextCompletion(
        server,
        `Provide concise answers to these research questions about "${topic}":\n\n${questions}\n\nFormat: Question 1: [answer]\nQuestion 2: [answer]...`,
        500,
        {
          modelPreferences: {
            hints: [{ name: 'claude' }],
            intelligencePriority: 0.8,
            speedPriority: 0.4,
          },
        },
      );
      results.push(`### Research Findings\n${answers}`);

      // Step 3: Synthesize into final format
      logger.debug('research_tool', { message: 'Step 3: Synthesizing results' });
      const formatInstructions = {
        summary: 'a concise 2-3 paragraph summary',
        detailed: 'a detailed report with sections and examples',
        academic: 'an academic-style paper with introduction, findings, and conclusion',
      };

      const synthesis = await requestTextCompletion(
        server,
        `Based on this research about "${topic}":\n\n${answers}\n\nCreate ${formatInstructions[format]}.`,
        format === 'academic' ? 1000 : format === 'detailed' ? 700 : 300,
        {
          modelPreferences: {
            hints: [{ name: 'claude' }],
            intelligencePriority: 0.9,
            speedPriority: 0.3,
          },
          systemPrompt: `You are a research synthesis expert. Create well-structured, insightful content.`,
        },
      );

      // Compile final report
      const report = [
        `# Research Report: ${topic}`,
        '',
        `**Depth**: ${depth} | **Format**: ${format}`,
        '',
        '---',
        '',
        results[0], // Questions
        '',
        results[1], // Findings
        '',
        '### Synthesis',
        synthesis,
        '',
        '---',
        '',
        `*Generated using agentic sampling with ${steps} research steps*`,
      ].join('\n');

      logger.info('research_tool', {
        message: 'Research completed successfully',
        topic,
        steps: steps,
      });

      return {
        content: [{ type: 'text', text: report }],
        structuredContent: {
          topic,
          depth,
          format,
          questions: questions,
          findings: answers,
          synthesis: synthesis,
          steps: steps,
        },
      };
    } catch (error) {
      logger.error('research_tool', {
        message: 'Research failed',
        error: (error as Error).message,
      });

      return {
        content: [
          {
            type: 'text',
            text: `## Research Failed\n\n${(error as Error).message}\n\nThis tool requires:\n1. Client with sampling capability\n2. Active LLM connection\n3. Sufficient token limits`,
          },
        ],
        isError: true,
      };
    }
  },
});
