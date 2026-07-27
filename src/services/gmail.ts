/**
 * Gmail API client.
 */

import type { ToolContext } from '../shared/tools/types.js';
import { sharedLogger as logger } from '../shared/utils/logger.js';
import type { GmailMessage } from '../utils/gmail.js';

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1';

export type GmailProfile = {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
};

export type GmailLabel = {
  id: string;
  name: string;
  type?: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: { textColor?: string; backgroundColor?: string };
};

export type GmailThreadListItem = {
  id: string;
  snippet?: string;
  historyId?: string;
};

export type GmailThread = {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
};

export interface ListThreadsParams {
  userId?: string;
  q?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
  maxResults?: number;
  pageToken?: string;
}

export type GmailMessageListItem = {
  id: string;
  threadId: string;
};

export interface ListMessagesParams {
  userId?: string;
  q?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
  maxResults?: number;
  pageToken?: string;
}

export interface GetThreadParams {
  userId?: string;
  id: string;
  format?: 'minimal' | 'metadata' | 'full' | 'raw';
  metadataHeaders?: string[];
}

export interface GetMessageParams {
  userId?: string;
  id: string;
  format?: 'minimal' | 'metadata' | 'full' | 'raw';
  metadataHeaders?: string[];
}

export interface ModifyThreadParams {
  userId?: string;
  threadId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export interface CreateDraftParams {
  userId?: string;
  raw: string;
  threadId?: string;
}

export interface UpdateDraftParams {
  userId?: string;
  draftId: string;
  raw: string;
  threadId?: string;
}

export interface SendDraftParams {
  userId?: string;
  draftId: string;
  raw?: string;
  threadId?: string;
}

export function getAccessToken(context?: ToolContext): string | undefined {
  // This value is populated only after the MCP resource token has been validated
  // and resolved through the project-specific AuthInfo.extra seam.
  return context?.providerToken;
}

export class GmailClient {
  private accessToken: string;
  private signal?: AbortSignal;

  constructor(accessToken: string, signal?: AbortSignal) {
    this.accessToken = accessToken;
    this.signal = signal;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${GMAIL_API_BASE}${path}`;
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal ?? this.signal,
      });

      if (!response.ok) {
        let errorMessage = `Gmail API error: ${response.status} ${response.statusText}`;
        try {
          const errorData = (await response.json()) as {
            error?: { message?: string; errors?: Array<{ reason?: string }> };
          };
          if (errorData.error?.message) {
            errorMessage += ` - ${errorData.error.message}`;
          }
          const reason = errorData.error?.errors?.[0]?.reason;
          if (reason) {
            errorMessage += ` (${reason})`;
          }
        } catch {
          // Ignore parse error
        }
        throw new Error(errorMessage);
      }

      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      logger.error('gmail-client', {
        message: 'Request failed',
        url,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getProfile(userId = 'me'): Promise<GmailProfile> {
    const path = `/users/${encodeURIComponent(userId)}/profile`;
    return this.request(path);
  }

  async listLabels(userId = 'me'): Promise<{ labels: GmailLabel[] }> {
    const path = `/users/${encodeURIComponent(userId)}/labels`;
    return this.request(path);
  }

  async listThreads(params: ListThreadsParams): Promise<{
    threads: GmailThreadListItem[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }> {
    const userId = params.userId ?? 'me';
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.includeSpamTrash !== undefined) {
      query.set('includeSpamTrash', String(params.includeSpamTrash));
    }
    if (params.maxResults) query.set('maxResults', String(params.maxResults));
    if (params.pageToken) query.set('pageToken', params.pageToken);
    if (params.labelIds?.length) {
      for (const labelId of params.labelIds) {
        query.append('labelIds', labelId);
      }
    }

    const path = `/users/${encodeURIComponent(userId)}/threads${query.toString() ? `?${query.toString()}` : ''}`;
    return this.request(path);
  }

  /**
   * List messages (sorted by internalDate descending - truly chronological).
   * Use this to find the actual newest messages regardless of thread creation time.
   */
  async listMessages(params: ListMessagesParams): Promise<{
    messages: GmailMessageListItem[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }> {
    const userId = params.userId ?? 'me';
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.includeSpamTrash !== undefined) {
      query.set('includeSpamTrash', String(params.includeSpamTrash));
    }
    if (params.maxResults) query.set('maxResults', String(params.maxResults));
    if (params.pageToken) query.set('pageToken', params.pageToken);
    if (params.labelIds?.length) {
      for (const labelId of params.labelIds) {
        query.append('labelIds', labelId);
      }
    }

    const path = `/users/${encodeURIComponent(userId)}/messages${query.toString() ? `?${query.toString()}` : ''}`;
    return this.request(path);
  }

  async getThread(params: GetThreadParams): Promise<GmailThread> {
    const userId = params.userId ?? 'me';
    const query = new URLSearchParams();
    if (params.format) query.set('format', params.format);
    if (params.metadataHeaders?.length) {
      for (const header of params.metadataHeaders) {
        query.append('metadataHeaders', header);
      }
    }
    const path = `/users/${encodeURIComponent(userId)}/threads/${encodeURIComponent(params.id)}${query.toString() ? `?${query.toString()}` : ''}`;
    return this.request(path);
  }

  async getMessage(params: GetMessageParams): Promise<GmailMessage> {
    const userId = params.userId ?? 'me';
    const query = new URLSearchParams();
    if (params.format) query.set('format', params.format);
    if (params.metadataHeaders?.length) {
      for (const header of params.metadataHeaders) {
        query.append('metadataHeaders', header);
      }
    }
    const path = `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(params.id)}${query.toString() ? `?${query.toString()}` : ''}`;
    return this.request(path);
  }

  async modifyThread(params: ModifyThreadParams): Promise<GmailThread> {
    const userId = params.userId ?? 'me';
    const body: Record<string, unknown> = {};
    if (params.addLabelIds?.length) body.addLabelIds = params.addLabelIds;
    if (params.removeLabelIds?.length) body.removeLabelIds = params.removeLabelIds;
    const path = `/users/${encodeURIComponent(userId)}/threads/${encodeURIComponent(params.threadId)}/modify`;
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async createDraft(
    params: CreateDraftParams,
  ): Promise<{ id: string; message: GmailMessage }> {
    const userId = params.userId ?? 'me';
    const body: Record<string, unknown> = {
      message: {
        raw: params.raw,
      },
    };
    if (params.threadId) {
      (body.message as Record<string, unknown>).threadId = params.threadId;
    }
    return this.request(`/users/${encodeURIComponent(userId)}/drafts`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateDraft(
    params: UpdateDraftParams,
  ): Promise<{ id: string; message: GmailMessage }> {
    const userId = params.userId ?? 'me';
    const body: Record<string, unknown> = {
      id: params.draftId,
      message: {
        raw: params.raw,
      },
    };
    if (params.threadId) {
      (body.message as Record<string, unknown>).threadId = params.threadId;
    }
    const path = `/users/${encodeURIComponent(userId)}/drafts/${encodeURIComponent(params.draftId)}`;
    return this.request(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async sendDraft(params: SendDraftParams): Promise<GmailMessage> {
    const userId = params.userId ?? 'me';
    const body: Record<string, unknown> = {
      id: params.draftId,
    };
    if (params.raw) {
      body.message = { raw: params.raw };
      if (params.threadId) {
        (body.message as Record<string, unknown>).threadId = params.threadId;
      }
    }
    const path = `/users/${encodeURIComponent(userId)}/drafts/send`;
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}
