const htmlElement = document.documentElement;
const colorScheme = htmlElement.classList.contains("dark") ? "dark" : "light";
chrome.runtime.sendMessage({
  message: "getColorScheme",
  colorScheme,
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getProjectConversationIdsFromDom(projectSlug) {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const ids = new Set();
  const projectPattern = new RegExp(`/g/${escapeRegExp(projectSlug)}/c/([a-z0-9-]+)`);

  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(projectPattern);
    if (match?.[1]) {
      ids.add(match[1]);
    }
  });

  return Array.from(ids);
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.message !== "getCurrentProjectConversationIds") {
    return;
  }

  try {
    const conversationIds = getProjectConversationIdsFromDom(request.projectSlug);
    console.log(`GPT-BACKUP::CONTENT::project-conversation-ids::${JSON.stringify({ projectSlug: request.projectSlug, conversationIds })}`);
    sendResponse({ conversationIds });
  } catch (error) {
    sendResponse({ error: error.message || String(error) });
  }

  return true;
});
