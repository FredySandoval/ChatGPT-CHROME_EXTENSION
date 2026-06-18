type ProjectConversationIdsRequest = {
  message?: string;
  projectSlug?: string;
};

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_end',
  main() {
    const htmlElement = document.documentElement;
    const colorScheme = htmlElement.classList.contains('dark') ? 'dark' : 'light';
    chrome.runtime.sendMessage({
      message: 'getColorScheme',
      colorScheme,
    });

    function escapeRegExp(value: string) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function getProjectConversationIdsFromDom(projectSlug: string) {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const ids = new Set<string>();
      const projectPattern = new RegExp(`/g/${escapeRegExp(projectSlug)}/c/([a-z0-9-]+)`);

      anchors.forEach((anchor) => {
        const href = anchor.getAttribute('href') || '';
        const match = href.match(projectPattern);
        if (match?.[1]) {
          ids.add(match[1]);
        }
      });

      return Array.from(ids);
    }

    chrome.runtime.onMessage.addListener((request: ProjectConversationIdsRequest, _sender, sendResponse) => {
      if (request?.message !== 'getCurrentProjectConversationIds') {
        return;
      }

      try {
        if (!request.projectSlug) {
          sendResponse({ error: 'Missing project slug' });
          return;
        }

        const conversationIds = getProjectConversationIdsFromDom(request.projectSlug);
        sendResponse({ conversationIds });
      } catch (error) {
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      }

      return true;
    });
  },
});
