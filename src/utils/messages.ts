export function summarizeList(params: {
  subject: string;
  count: number;
  limit?: number;
  nextCursor?: string | undefined;
  previewLines?: string[];
  zeroReasonHints?: string[];
  nextSteps?: string[];
}): string {
  const bits: string[] = [];
  const header = `${params.subject}: ${params.count}${
    typeof params.limit === 'number' ? ` (limit ${params.limit})` : ''
  }${params.nextCursor ? ', more available' : ''}.`;
  bits.push(header);

  if (params.previewLines?.length) {
    bits.push(`Preview:\n${params.previewLines.map((l) => `- ${l}`).join('\n')}`);
  }

  if (!params.count && params.zeroReasonHints?.length) {
    bits.push(`No results. Try: ${params.zeroReasonHints.join('; ')}.`);
  }

  const next = params.nextSteps?.length
    ? `Suggested next steps: ${params.nextSteps.join(' ')}`
    : params.nextCursor
      ? `Suggested next steps: pass cursor '${params.nextCursor}' to fetch the next page.`
      : undefined;

  if (next) bits.push(next);
  return bits.join(' ');
}

export function formatErrorWithHints(message: string, hints?: string[]): string {
  if (!hints || hints.length === 0) return message;
  return `${message}\nHints: ${hints.join(' ')}`;
}
