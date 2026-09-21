/** Shared content model: independent of HTML rendering and PDF generation. */
export type ExportConversation = {
  title?: string;
  messages: {
    role: string;
    markdown: string;
    images: { name: string; data?: string }[];
    attachments: string[];
  }[];
};

export type ExportLabels = { userLabel?: string; assistantLabel?: string };

export function selectMessages(chat: ExportConversation, included: ReadonlySet<number>): ExportConversation {
  return { ...chat, messages: chat.messages.filter((_, index) => included.has(index)) };
}

export function messageLabel(role: string, labels: ExportLabels): string {
  return role === 'user' ? labels.userLabel ?? 'USER' : labels.assistantLabel ?? 'ASSISTANT';
}

export function safeExportLink(url: string): string | undefined {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined;
}
