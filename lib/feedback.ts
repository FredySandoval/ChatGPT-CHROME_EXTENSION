// Reports contain only explicitly selected metadata, never existing logs or raw errors.
export function classifyReportError(text: string): string {
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
