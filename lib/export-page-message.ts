/** Capture Chrome's callback-scoped transport errors instead of masking them as missing chat data. */
export function exportPageMessage<T>(request: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: T | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message || 'Could not contact the export service.'));
      else if (response === undefined || response === null) reject(new Error('The export service did not respond. Reload the extension at chrome://extensions, then reopen this export page.'));
      else resolve(response);
    });
  });
}
