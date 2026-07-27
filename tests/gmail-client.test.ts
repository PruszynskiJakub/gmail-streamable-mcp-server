import { afterEach, describe, expect, test } from 'bun:test';
import { GmailClient } from '../src/services/gmail.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Gmail API client compatibility', () => {
  test('preserves every Gmail method, URL, body, and provider Authorization header', async () => {
    const requests: Array<{
      url: string;
      method: string;
      authorization: string | null;
      body?: string;
    }> = [];
    globalThis.fetch = Object.assign(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const request = {
          url: input instanceof Request ? input.url : input.toString(),
          method: init?.method ?? 'GET',
          authorization: new Headers(init?.headers).get('Authorization'),
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        };
        requests.push(request);
        return Response.json({
          emailAddress: 'user@example.com',
          labels: [],
          threads: [],
          messages: [],
          id: 'result-id',
          message: { id: 'message-id' },
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    const client = new GmailClient('gmail-provider-token');
    await client.getProfile();
    await client.listLabels();
    await client.listThreads({
      q: 'is:unread',
      labelIds: ['INBOX', 'STARRED'],
      includeSpamTrash: true,
      maxResults: 25,
      pageToken: 'thread-cursor',
    });
    await client.listMessages({
      q: 'from:alice',
      labelIds: ['SENT'],
      includeSpamTrash: false,
      maxResults: 10,
      pageToken: 'message-cursor',
    });
    await client.getThread({
      id: 'thread/id',
      format: 'metadata',
      metadataHeaders: ['Subject', 'From'],
    });
    await client.getMessage({
      id: 'message/id',
      format: 'full',
      metadataHeaders: ['Date'],
    });
    await client.modifyThread({
      threadId: 'thread/id',
      addLabelIds: ['STARRED'],
      removeLabelIds: ['UNREAD'],
    });
    await client.createDraft({
      raw: 'raw-create',
      threadId: 'thread-id',
    });
    await client.updateDraft({
      draftId: 'draft/id',
      raw: 'raw-update',
      threadId: 'thread-id',
    });
    await client.sendDraft({
      draftId: 'draft-id',
      raw: 'raw-send',
      threadId: 'thread-id',
    });

    expect(requests.map(({ url, method }) => ({ url, method }))).toEqual([
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/profile',
        method: 'GET',
      },
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/labels',
        method: 'GET',
      },
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/threads?q=is%3Aunread&includeSpamTrash=true&maxResults=25&pageToken=thread-cursor&labelIds=INBOX&labelIds=STARRED',
        method: 'GET',
      },
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/messages?q=from%3Aalice&includeSpamTrash=false&maxResults=10&pageToken=message-cursor&labelIds=SENT',
        method: 'GET',
      },
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/threads/thread%2Fid?format=metadata&metadataHeaders=Subject&metadataHeaders=From',
        method: 'GET',
      },
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/messages/message%2Fid?format=full&metadataHeaders=Date',
        method: 'GET',
      },
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/threads/thread%2Fid/modify',
        method: 'POST',
      },
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/drafts',
        method: 'POST',
      },
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/drafts/draft%2Fid',
        method: 'PUT',
      },
      {
        url: 'https://www.googleapis.com/gmail/v1/users/me/drafts/send',
        method: 'POST',
      },
    ]);
    expect(
      requests.every(
        (request) => request.authorization === 'Bearer gmail-provider-token',
      ),
    ).toBe(true);
    expect(JSON.parse(requests[6]?.body as string)).toEqual({
      addLabelIds: ['STARRED'],
      removeLabelIds: ['UNREAD'],
    });
    expect(JSON.parse(requests[7]?.body as string)).toEqual({
      message: { raw: 'raw-create', threadId: 'thread-id' },
    });
    expect(JSON.parse(requests[8]?.body as string)).toEqual({
      id: 'draft/id',
      message: { raw: 'raw-update', threadId: 'thread-id' },
    });
    expect(JSON.parse(requests[9]?.body as string)).toEqual({
      id: 'draft-id',
      message: { raw: 'raw-send', threadId: 'thread-id' },
    });
  });

  test('preserves Gmail provider error details', async () => {
    globalThis.fetch = Object.assign(
      async () =>
        Response.json(
          {
            error: {
              message: 'Invalid Credentials',
              errors: [{ reason: 'authError' }],
            },
          },
          { status: 401, statusText: 'Unauthorized' },
        ),
      { preconnect: originalFetch.preconnect },
    );
    const client = new GmailClient('expired-gmail-token');
    await expect(client.getProfile()).rejects.toThrow(
      'Gmail API error: 401 Unauthorized - Invalid Credentials (authError)',
    );
  });
});
