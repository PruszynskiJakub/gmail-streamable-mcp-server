import {
  base64UrlDecodeString,
  base64UrlEncodeString,
} from '../shared/utils/base64.js';
import { truncate } from './formatting.js';

export type GmailHeader = { name: string; value: string };

export type GmailMessagePayload = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePayload[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailMessagePayload;
  raw?: string;
};

export type ComposeMessageInput = {
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  subject?: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
};

const GMAIL_WEB_BASE = 'https://mail.google.com/mail/u/0/#';

export function buildGmailThreadUrl(threadId?: string): string | undefined {
  if (!threadId) return undefined;
  return `${GMAIL_WEB_BASE}all/${encodeURIComponent(threadId)}`;
}

export function buildGmailMessageUrl(messageId?: string): string | undefined {
  if (!messageId) return undefined;
  return `${GMAIL_WEB_BASE}all/${encodeURIComponent(messageId)}`;
}

export function buildGmailWebUrl(params: {
  threadId?: string;
  messageId?: string;
}): string | undefined {
  return buildGmailThreadUrl(params.threadId) ?? buildGmailMessageUrl(params.messageId);
}

export function getGmailErrorHints(message: string): string[] {
  const lower = message.toLowerCase();
  const hints: string[] = [];

  if (lower.includes('401') || lower.includes('invalid credentials')) {
    hints.push('Re-authenticate the Gmail connection.');
  }
  if (lower.includes('403') || lower.includes('insufficientpermissions')) {
    hints.push('Check OAuth scopes and re-authenticate if scopes changed.');
  }
  if (lower.includes('404') || lower.includes('notfound')) {
    hints.push('Verify the threadId/messageId/draftId exists and belongs to the user.');
  }
  if (lower.includes('429') || lower.includes('ratelimit')) {
    hints.push('Retry with exponential backoff.');
  }
  if (lower.includes('400') || lower.includes('invalidargument')) {
    hints.push('Check query syntax, labelIds, or raw RFC 2822 formatting.');
  }

  return hints;
}

export function normalizeAddressList(input?: string | string[]): string[] {
  if (!input) return [];
  return Array.isArray(input) ? input.filter(Boolean) : [input];
}

export function formatAddressList(addresses: string[]): string | undefined {
  if (addresses.length === 0) return undefined;
  return addresses.join(', ');
}

export function buildMimeMessage(input: ComposeMessageInput): string {
  const headers: string[] = [];

  if (input.from) headers.push(`From: ${input.from}`);
  if (input.to?.length) headers.push(`To: ${formatAddressList(input.to)}`);
  if (input.cc?.length) headers.push(`Cc: ${formatAddressList(input.cc)}`);
  if (input.bcc?.length) headers.push(`Bcc: ${formatAddressList(input.bcc)}`);
  if (input.replyTo?.length)
    headers.push(`Reply-To: ${formatAddressList(input.replyTo)}`);
  if (input.subject) headers.push(`Subject: ${input.subject}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references?.length)
    headers.push(`References: ${input.references.join(' ')}`);

  headers.push('MIME-Version: 1.0');

  const hasText = typeof input.text === 'string' && input.text.length > 0;
  const hasHtml = typeof input.html === 'string' && input.html.length > 0;

  if (hasText && hasHtml) {
    const boundary = `mcp_boundary_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.text ?? '',
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.html ?? '',
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    return `${headers.join('\r\n')}\r\n\r\n${body}`;
  }

  const mimeType = hasHtml ? 'text/html' : 'text/plain';
  headers.push(`Content-Type: ${mimeType}; charset="UTF-8"`);
  headers.push('Content-Transfer-Encoding: 7bit');

  const bodyText = hasHtml ? input.html : (input.text ?? '');
  return `${headers.join('\r\n')}\r\n\r\n${bodyText}`;
}

export function encodeMimeMessage(input: ComposeMessageInput): string {
  return base64UrlEncodeString(buildMimeMessage(input));
}

export function decodeMessageBody(
  data?: string,
  maxChars?: number,
): string | undefined {
  if (!data) return undefined;
  try {
    const decoded = base64UrlDecodeString(data);
    if (typeof maxChars === 'number') {
      return truncate(decoded, maxChars);
    }
    return decoded;
  } catch {
    return undefined;
  }
}

export function pickHeader(
  headers: GmailHeader[] | undefined,
  name: string,
): string | undefined {
  if (!headers || headers.length === 0) return undefined;
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found?.value;
}

/**
 * Extract display name from email address format.
 * "John Doe" <john@example.com> -> John Doe
 * john@example.com -> john@example.com
 */
export function extractDisplayName(from: string | undefined): string | undefined {
  if (!from) return undefined;
  // Match "Name" <email> or Name <email>
  const match = from.match(/^"?([^"<]+)"?\s*<.+>$/);
  if (match) return match[1].trim();
  // Match <email> only
  if (from.startsWith('<') && from.endsWith('>')) {
    return from.slice(1, -1);
  }
  return from;
}

export function extractHeaders(headers?: GmailHeader[]): {
  rawHeaders: GmailHeader[];
  parsed: {
    subject?: string;
    from?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    date?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
  };
} {
  const raw = headers ?? [];
  return {
    rawHeaders: raw,
    parsed: {
      subject: pickHeader(raw, 'Subject'),
      from: pickHeader(raw, 'From'),
      to: pickHeader(raw, 'To'),
      cc: pickHeader(raw, 'Cc'),
      bcc: pickHeader(raw, 'Bcc'),
      replyTo: pickHeader(raw, 'Reply-To'),
      date: pickHeader(raw, 'Date'),
      messageId: pickHeader(raw, 'Message-Id') ?? pickHeader(raw, 'Message-ID'),
      inReplyTo: pickHeader(raw, 'In-Reply-To'),
      references: pickHeader(raw, 'References'),
    },
  };
}

export function extractBodies(
  payload?: GmailMessagePayload,
  maxBodyChars?: number,
): { text?: string; html?: string } {
  if (!payload) return {};
  let text: string | undefined;
  let html: string | undefined;

  const visit = (part: GmailMessagePayload | undefined): void => {
    if (!part) return;
    const mimeType = part.mimeType ?? '';

    if (mimeType === 'text/plain' && !text) {
      text = decodeMessageBody(part.body?.data, maxBodyChars);
    }

    if (mimeType === 'text/html' && !html) {
      html = decodeMessageBody(part.body?.data, maxBodyChars);
    }

    if (part.parts && part.parts.length > 0) {
      for (const child of part.parts) {
        if (text && html) break;
        visit(child);
      }
    }
  };

  visit(payload);
  return { text, html };
}

export function normalizeMessage(
  message: GmailMessage,
  options?: { includeBody?: boolean; maxBodyChars?: number; includeRaw?: boolean },
): {
  id: string;
  threadId?: string;
  historyId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  webUrl?: string;
  headers?: ReturnType<typeof extractHeaders>['parsed'];
  rawHeaders?: GmailHeader[];
  body?: { text?: string; html?: string; raw?: string };
} {
  const { includeBody = false, maxBodyChars, includeRaw = false } = options ?? {};
  const { rawHeaders, parsed } = extractHeaders(message.payload?.headers);
  const body = includeBody ? extractBodies(message.payload, maxBodyChars) : {};

  return {
    id: message.id,
    threadId: message.threadId,
    historyId: message.historyId,
    labelIds: message.labelIds,
    snippet: message.snippet,
    internalDate: message.internalDate,
    sizeEstimate: message.sizeEstimate,
    webUrl: buildGmailWebUrl({ threadId: message.threadId, messageId: message.id }),
    headers: Object.keys(parsed).length > 0 ? parsed : undefined,
    rawHeaders: rawHeaders.length > 0 ? rawHeaders : undefined,
    body:
      includeBody || includeRaw
        ? {
            ...body,
            ...(includeRaw && message.raw ? { raw: message.raw } : {}),
          }
        : undefined,
  };
}
