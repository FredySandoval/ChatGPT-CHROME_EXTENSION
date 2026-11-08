// Reports contain only explicitly selected metadata, never existing logs or raw errors.
export type FailureStage = 'SOURCE_SELECTION' | 'FETCH_CONVERSATION' | 'CONVERT' | 'DOWNLOAD' | 'UNKNOWN';

export function reportFailureStage(value: unknown): FailureStage {
  return value === 'SOURCE_SELECTION' || value === 'FETCH_CONVERSATION' || value === 'CONVERT' || value === 'DOWNLOAD' ? value : 'UNKNOWN';
}
export function classifyReportError(text: string): string {
  const code = text.match(/^(?:Error: )?(SOURCE_TAB_UNAVAILABLE|SOURCE_UNSUPPORTED|SOURCE_NOT_SAVED|CONVERSATION_INVALID|DOWNLOAD_INTERRUPTED|DOWNLOAD_TIMEOUT|DOWNLOAD_FAILED|RESPONSE_MISSING)(?::|$)/)?.[1];
  if (code) return code;
  if (/message channel closed|asynchronous response/i.test(text)) return 'MESSAGE_CHANNEL_CLOSED';
  if (/receiving end|establish connection/i.test(text)) return 'CONNECTION_UNAVAILABLE';
  if (/401|unauthorized|sign in/i.test(text)) return 'AUTHORIZATION_FAILED';
  if (/429|rate limit/i.test(text)) return 'RATE_LIMITED';
  if (/clipboard/i.test(text)) return 'CLIPBOARD_FAILED';
  return 'OPERATION_FAILED';
}

export function emailDraft(subject: string, body: string, category: 'bugs' | 'feedback' = 'bugs'): string {
  const recipient = `support+${category}@fredy.dev`;
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
