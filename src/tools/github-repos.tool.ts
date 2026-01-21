/**
 * Example OAuth-enabled tool: List GitHub repositories.
 * Demonstrates using OAuth tokens from RequestContext to call external APIs.
 */

import { z } from 'zod';
import type { RequestContext } from '../types/context.js';
import { logger } from '../utils/logger.js';
import { defineTool } from './tool-utils.js';

/**
 * Input schema for GitHub repos tool.
 */
const GitHubReposInputSchema = z.object({
  username: z
    .string()
    .optional()
    .describe('GitHub username (defaults to authenticated user if omitted)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .describe('Maximum number of repositories to return'),
  sort: z
    .enum(['created', 'updated', 'pushed', 'full_name'])
    .optional()
    .default('updated')
    .describe('Sort repositories by'),
});

type GitHubReposInput = z.infer<typeof GitHubReposInputSchema>;

/**
 * GitHub repository response type.
 */
interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
}

/**
 * List GitHub repositories for a user.
 *
 * This tool demonstrates:
 * 1. Accessing OAuth tokens from RequestContext
 * 2. Using service tokens to call external APIs
 * 3. Handling authentication errors gracefully
 * 4. Providing rich structured responses
 */
export const githubReposTool = defineTool({
  name: 'github-repos',
  description:
    'List GitHub repositories for a user. Requires GitHub OAuth authentication.',
  inputSchema: GitHubReposInputSchema,
  handler: async (
    { username, limit = 10, sort = 'updated' }: GitHubReposInput,
    context?: RequestContext,
  ) => {
    try {
      // Check for authentication
      if (!context?.authHeaders?.authorization) {
        return {
          content: [
            {
              type: 'text',
              text: '## Authentication Required\n\nThis tool requires GitHub OAuth authentication. Please configure OAuth and provide a Bearer token.',
            },
          ],
          isError: true,
        };
      }

      // Extract token (should be service token, translated by OAuth middleware)
      const authHeader = context.authHeaders.authorization;
      const match = authHeader.match(/^\s*Bearer\s+(.+)$/i);
      const token = match?.[1];

      if (!token) {
        return {
          content: [
            {
              type: 'text',
              text: '## Invalid Token\n\nAuthorization header must be in format: Bearer <token>',
            },
          ],
          isError: true,
        };
      }

      logger.info('github_repos_tool', {
        message: 'Fetching GitHub repositories',
        username: username || 'authenticated user',
        limit,
        sort,
        provider: context.provider,
      });

      // Build GitHub API URL
      const url = username
        ? `https://api.github.com/users/${username}/repos`
        : 'https://api.github.com/user/repos';

      // Call GitHub API
      const response = await fetch(
        `${url}?per_page=${limit}&sort=${sort}&direction=desc`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'MCP-Template',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        logger.error('github_repos_tool', {
          message: 'GitHub API error',
          status: response.status,
          error: errorText,
        });

        return {
          content: [
            {
              type: 'text',
              text: `## GitHub API Error\n\n**Status**: ${response.status}\n**Error**: ${errorText}\n\nPlease check your OAuth token and permissions.`,
            },
          ],
          isError: true,
        };
      }

      const repos: GitHubRepo[] = await response.json();

      if (repos.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `## No Repositories Found\n\nNo repositories found for ${username || 'authenticated user'}.`,
            },
          ],
        };
      }

      // Format response
      const repoList = repos
        .map(
          (repo) =>
            `### ${repo.name}\n\n` +
            `${repo.description || '_No description_'}\n\n` +
            `- **URL**: ${repo.html_url}\n` +
            `- **Language**: ${repo.language || 'N/A'}\n` +
            `- **Stars**: ${repo.stargazers_count}\n` +
            `- **Forks**: ${repo.forks_count}\n` +
            `- **Private**: ${repo.private ? 'Yes' : 'No'}\n` +
            `- **Updated**: ${new Date(repo.updated_at).toLocaleString()}\n`,
        )
        .join('\n');

      const markdown = [
        `## GitHub Repositories${username ? ` for ${username}` : ''}`,
        '',
        `Found ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}`,
        `Sorted by: ${sort}`,
        '',
        repoList,
      ].join('\n');

      logger.info('github_repos_tool', {
        message: 'Successfully fetched GitHub repositories',
        count: repos.length,
      });

      return {
        content: [{ type: 'text', text: markdown }],
        structuredContent: {
          repositories: repos.map((r) => ({
            name: r.name,
            fullName: r.full_name,
            description: r.description,
            url: r.html_url,
            language: r.language,
            stars: r.stargazers_count,
            forks: r.forks_count,
            private: r.private,
            updatedAt: r.updated_at,
          })),
          count: repos.length,
          username: username || 'authenticated user',
        },
      };
    } catch (error) {
      logger.error('github_repos_tool', {
        message: 'Error fetching GitHub repositories',
        error: (error as Error).message,
      });

      return {
        content: [
          {
            type: 'text',
            text: `## Error\n\nFailed to fetch GitHub repositories: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
});
