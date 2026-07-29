type LocaleMessages = typeof import('../public/_locales/en/messages.json');

export type MessageKey = keyof LocaleMessages;

export function t(messageName: MessageKey, substitutions?: string | string[]): string {
  const message = chrome.i18n.getMessage(messageName, substitutions);

  if (!message) {
    console.warn(`[i18n] Missing message: ${messageName}`);
    return messageName;
  }

  return message;
}

export function localizeDocument(titleMessageName: MessageKey): void {
  const uiLocale = chrome.i18n.getMessage('@@ui_locale') || chrome.i18n.getUILanguage();
  document.documentElement.lang = uiLocale.replaceAll('_', '-');
  document.title = t(titleMessageName);
}
