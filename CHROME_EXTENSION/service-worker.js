function generateOffsets(startOffset, total) {
  const interval = 20;
  const start = startOffset + interval;
  const offsets = [];

  for (let i = start; i <= total; i += interval) {
    offsets.push(i);
  }

  return offsets;
}

function sleep(ms = 1000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setProgress(text, total, status = 'running') {
  progressState = text;
  ports.forEach((port) => port.postMessage({ text, total, status }));
}

function createCancellationController() {
  return { cancelled: false };
}

function isCancelled(controller) {
  return Boolean(controller?.cancelled);
}

function throwIfCancelled(controller) {
  if (isCancelled(controller)) {
    throw new Error('Backup stopped by user');
  }
}

function sanitizeFilename(name = 'untitled') {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

function dedupeFilename(baseName, seenNames) {
  let candidate = baseName;
  let counter = 2;

  while (seenNames.has(candidate)) {
    candidate = `${baseName} (${counter})`;
    counter += 1;
  }

  seenNames.add(candidate);
  return candidate;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getReferenceReplacement(reference) {
  if (!reference) return '';

  const matchedText = String(reference.matched_text || '');
  const safeUrls = Array.isArray(reference.safe_urls) ? reference.safe_urls.filter(Boolean) : [];

  if (matchedText.includes('image_group')) {
    return safeUrls.map((url, index) => `![Image ${index + 1}](${url})`).join('\n\n');
  }

  if (matchedText.includes('entity')) {
    const entityMatch = matchedText.match(/entity(.*?)/);
    if (entityMatch) {
      try {
        const parsed = JSON.parse(entityMatch[1]);
        return parsed[1] || parsed[2] || matchedText;
      } catch (error) {
        console.warn('GPT-BACKUP::ENTITY::parse-failed', matchedText, error);
      }
    }
  }

  if (safeUrls.length) {
    return safeUrls.join('\n');
  }

  return matchedText;
}

function applyContentReferences(text, metadata = {}) {
  let rendered = String(text || '');
  const references = Array.isArray(metadata.content_references) ? metadata.content_references : [];

  for (const reference of references) {
    const matchedText = String(reference?.matched_text || '');
    if (!matchedText) continue;

    const replacement = getReferenceReplacement(reference);
    rendered = rendered.replace(new RegExp(escapeRegExp(matchedText), 'g'), replacement);
  }

  rendered = rendered.replace(/[^]*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return rendered;
}

function enrichMessage(message) {
  const rawText = Array.isArray(message.content)
    ? message.content.filter((part) => part != null && String(part).trim() !== '').join('\n\n')
    : String(message.content || '');
  const renderedMarkdown = applyContentReferences(rawText, message.metadata || {});
  const renderedText = renderedMarkdown
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/<img\s+[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '$1 $2');

  return {
    ...message,
    rendered_markdown: renderedMarkdown,
    rendered_text: renderedText,
  };
}

function enrichChatsForJson(chats) {
  return chats.map((chat) => ({
    ...chat,
    messages: Array.isArray(chat.messages) ? chat.messages.map(enrichMessage) : [],
  }));
}

function parseConversation(rawConversation) {
  const title = rawConversation?.title;
  const create_time = rawConversation?.create_time;
  const mapping = rawConversation?.mapping || {};
  const keys = Object.keys(mapping);
  const messages = [];

  console.log('GPT-BACKUP::PARSE::conversation', {
    title,
    create_time,
    mappingKeys: keys.length,
  });

  for (const k of keys) {
    const msgPayload = mapping[k];
    const msg = msgPayload?.message;
    if (!msg) continue;

    const role = msg.author?.role;
    if (role !== 'user' && role !== 'assistant') continue;

    const rawContent = msg.content;
    const parts = Array.isArray(rawContent?.parts)
      ? rawContent.parts
      : rawContent?.text != null
        ? [String(rawContent.text)]
        : [];

    const metadata = msg.metadata || {};
    const contentType = rawContent?.content_type || rawContent?.contentType || null;

    if (
      role === 'assistant' && (
        contentType ||
        metadata?.attachments ||
        metadata?.citations ||
        metadata?.aggregate_result ||
        JSON.stringify(rawContent || {}).includes('image') ||
        JSON.stringify(metadata || {}).includes('image')
      )
    ) {
      console.log('GPT-BACKUP::PARSE::assistant-rich-content', {
        title,
        messageId: msg.id,
        contentType,
        metadataKeys: Object.keys(metadata || {}),
        rawContent,
        metadata,
      });
    }

    const content = parts
      .filter((part) => part != null)
      .map((part) => typeof part === 'string' ? part : JSON.stringify(part));

    if (!content.length) continue;

    const model = msg.metadata?.model_slug || null;
    const messageCreateTime = msg.create_time;

    messages.push({
      role,
      content,
      model,
      create_time: messageCreateTime,
      metadata,
      contentType,
    });
  }

  messages.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));

  return {
    messages,
    create_time,
    title,
  };
}

function getRequestCount(total, startOffset, stopOffset) {
  if (stopOffset === -1) return total;

  return stopOffset - startOffset;
}

function logProgress(total, messages, offset) {
  const progress = Math.round((messages / total) * 100);
  console.log(`GPT-BACKUP::PROGRESS::${progress}%::OFFSET::${offset}`);
}

async function storeToken(token) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ access_token: token }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}
async function getToken() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get('access_token', (items) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(items.access_token);
      }
    });
  });
}
async function loadToken() {
  const storedToken = await getToken();
  if (storedToken) return storedToken;

  const res = await fetch('https://chatgpt.com/api/auth/session');
  if (res.ok) {
    const accessToken = (await res.json()).accessToken;
    await storeToken(accessToken);
    return accessToken;
  }
  return Promise.reject('failed to fetch token');
}

async function getFirstConversationId() {
  const token = await loadToken();

  const res = await fetch(
    'https://chatgpt.com/backend-api/conversations?offset=0&limit=1',
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (!res.ok) {
    if (res.status === 401) {
      await chrome.storage.sync.remove('access_token');
    }
    throw new Error('failed to fetch conversation ids, token expired? try again');
  }

  const json = await res.json();
  return json.items[0].id;
}

async function getConversationIds(token, offset = 0) {
  const res = await fetch(
    `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=20`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (!res.ok) {
    if (res.status === 401) {
      await chrome.storage.sync.remove('access_token');
    }
    throw new Error(`failed to fetch conversation ids (${res.status})`);
  }

  const json = await res.json();
  return {
    items: json.items.map((item) => ({ ...item, offset })),
    total: json.total,
  };
}

async function fetchConversation(token, id, maxAttempts = 5, attempt = 1) {
  const res = await fetch(
    `https://chatgpt.com/backend-api/conversation/${id}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (!res.ok) {
    const exceeded = attempt >= maxAttempts;
    if (res.status === 401) {
      await chrome.storage.sync.remove('access_token');
      throw new Error('failed to fetch conversation (401)');
    }

    if ((res.status === 429 || res.status >= 500) && !exceeded) {
      await sleep(Math.min(5000 * attempt, 30000));
      return fetchConversation(token, id, maxAttempts, attempt + 1);
    }

    throw new Error(`failed to fetch conversation (${res.status})`);
  }

  return res.json();
}

async function getAllConversations(startOffset, stopOffset, controller) {
  let token = await loadToken();
  let cancelled = false;

  if (isCancelled(controller)) {
    console.log('GPT-BACKUP::CANCELLED::before-initial-conversation-list');
    return { conversations: [], failures: [], requested: 0, totalAvailable: 0, cancelled: true };
  }

  const { total, items: allItems } = await getConversationIds(token, startOffset);

  const offsets = generateOffsets(startOffset, total);

  for (const offset of offsets) {
    if (offset === stopOffset) break;

    if (isCancelled(controller)) {
      cancelled = true;
      console.log(`GPT-BACKUP::CANCELLED::during-offset-pagination::offset=${offset}`);
      break;
    }
    await sleep();

    try {
      const { items } = await getConversationIds(token, offset);
      allItems.push.apply(allItems, items);
    } catch (error) {
      if (String(error.message).includes('(401)')) {
        token = await loadToken();
        const { items } = await getConversationIds(token, offset);
        allItems.push.apply(allItems, items);
      } else {
        throw error;
      }
    }
  }

  const lastOffset = stopOffset === -1 ? offsets[offsets.length - 1] : stopOffset;

  const allConversations = [];
  const requested = getRequestCount(total, startOffset, stopOffset);
  const failures = [];

  console.log(`GPT-BACKUP::STARTING::TOTAL-OFFSETS::${lastOffset}`);
  console.log(`GPT-BACKUP::STARTING::REQUESTED-MESSAGES::${requested}`);
  console.log(`GPT-BACKUP::STARTING::TOTAL-MESSAGES::${total}`);
  setProgress('Fetching chats...', 0, 'running');

  for (const item of allItems) {
    if (isCancelled(controller)) {
      cancelled = true;
      console.log(`GPT-BACKUP::CANCELLED::before-conversation-fetch::fetched=${allConversations.length}`);
      break;
    }
    await sleep(1000);
    if (isCancelled(controller)) {
      cancelled = true;
      console.log(`GPT-BACKUP::CANCELLED::after-wait-before-conversation-fetch::fetched=${allConversations.length}`);
      break;
    }

    if (allConversations.length % 20 === 0) {
      logProgress(requested, allConversations.length, item.offset);
    }

    try {
      const rawConversation = await fetchConversation(token, item.id);
      const conversation = parseConversation(rawConversation);
      allConversations.push(conversation);
      const title = conversation.title || 'untitled';
      const shortTitle = title.length > 20 ? `${title.substring(0, 20)}...` : title;
      setProgress(shortTitle, allConversations.length, 'running');
    } catch (error) {
      if (String(error.message).includes('(401)')) {
        try {
          token = await loadToken();
          const rawConversation = await fetchConversation(token, item.id);
          const conversation = parseConversation(rawConversation);
          allConversations.push(conversation);
          const title = conversation.title || 'untitled';
          const shortTitle = title.length > 20 ? `${title.substring(0, 20)}...` : title;
          setProgress(shortTitle, allConversations.length, 'running');
          continue;
        } catch (retryError) {
          failures.push({ id: item.id, error: retryError.message || String(retryError) });
        }
      } else {
        failures.push({ id: item.id, error: error.message || String(error) });
      }

      console.warn('Skipping conversation', item.id, failures[failures.length - 1]);
      setProgress(`Skipped ${failures.length} chat(s)`, allConversations.length, 'warning');
    }
  }

  logProgress(requested, allConversations.length, lastOffset);

  return { conversations: allConversations, failures, requested, totalAvailable: total, cancelled };
}

async function main(startOffset, stopOffset, controller) {
  return getAllConversations(startOffset, stopOffset, controller);
}

let progressState = '';
let activeBackupController = null;
const ports = new Set();
chrome.runtime.onConnect.addListener(function (port) {
  console.assert(port.name == 'progress');
  ports.add(port);
  port.postMessage({ text: progressState, status: 'idle' });
  port.onDisconnect.addListener(function () {
    ports.delete(port);
  });
});
importScripts('./jszip.js');
function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
}

async function blobToDataUrl(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const base64Data = bytesToBase64(new Uint8Array(arrayBuffer));
  return `data:${blob.type || 'application/octet-stream'};base64,${base64Data}`;
}

async function saveAs(contentString = '', fileType = 'text/plain', filename = 'file.txt') {
  let dataUrl = null;
  let shouldRevokeObjectUrl = false;

  if (fileType === 'application/zip') {
    dataUrl = `data:${fileType};base64,${contentString}`;
  } else {
    const blob = new Blob([contentString], { type: fileType });

    try {
      if (typeof URL?.createObjectURL === 'function') {
        dataUrl = URL.createObjectURL(blob);
        shouldRevokeObjectUrl = true;
      } else {
        dataUrl = await blobToDataUrl(blob);
      }
    } catch (error) {
      console.warn('Falling back to data URL download', error);
      dataUrl = await blobToDataUrl(blob);
      shouldRevokeObjectUrl = false;
    }
  }

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: true,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        if (shouldRevokeObjectUrl) {
          URL.revokeObjectURL(dataUrl);
        }
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      console.log('Download initiated with ID:', downloadId);

      if (!shouldRevokeObjectUrl) {
        resolve(downloadId);
        return;
      }

      const onChanged = (delta) => {
        if (delta.id === downloadId && (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')) {
          URL.revokeObjectURL(dataUrl);
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve(downloadId);
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
    });
  });
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.message === 'getColorScheme') {
    chrome.storage.local.set({ colorScheme: request.colorScheme });
  }

  if (request.message === 'backUpAllAsJSON') {
    console.log('GPT-BACKUP::START::JSON');
    activeBackupController = createCancellationController();
    main(request.startOffset, request.stopOffset, activeBackupController)
      .then(async (result) => {
        const progressLabel = result.cancelled ? 'Building partial JSON file...' : 'Building JSON file...';
        setProgress(progressLabel, result.conversations.length, result.cancelled ? 'cancelled' : 'running');
        await downloadJson(result.conversations);
        const summary = result.cancelled
          ? `Stopped and downloaded ${result.conversations.length} chats${result.failures.length ? `, skipped ${result.failures.length}` : ''}`
          : result.failures.length
            ? `Downloaded ${result.conversations.length} chats, skipped ${result.failures.length}`
            : `Downloaded ${result.conversations.length} chats`;
        setProgress(summary, result.conversations.length, result.cancelled || result.failures.length ? 'warning' : 'done');
        activeBackupController = null;
        sendResponse({ message: result.cancelled ? 'backUpAllAsJSON partial' : 'backUpAllAsJSON done', ...result, cancelled: result.cancelled });
      })
      .catch((error) => {
        console.error('GPT-BACKUP::ERROR::JSON', error);
        const wasCancelled = String(error.message || error) === 'Backup stopped by user';
        setProgress(wasCancelled ? 'Backup stopped' : `Backup failed: ${error.message || error}`, 0, wasCancelled ? 'cancelled' : 'error');
        activeBackupController = null;
        sendResponse({ message: wasCancelled ? 'backUpAllAsJSON stopped' : 'backUpAllAsJSON failed', error: error.message || String(error), cancelled: wasCancelled });
      });
  }
  if (request.message === 'backUpAllAsMARKDOWN') {
    console.log('GPT-BACKUP::START::MARKDOWN', request);
    activeBackupController = createCancellationController();
    main(request.startOffset, request.stopOffset, activeBackupController)
      .then(async (result) => {
        const progressLabel = result.cancelled ? 'Building partial markdown zip...' : 'Building markdown zip...';
        setProgress(progressLabel, result.conversations.length, result.cancelled ? 'cancelled' : 'running');
        await downloadMarkdownZip(result.conversations, request.userLabel, request.assistantLabel);
        const summary = result.cancelled
          ? `Stopped and downloaded ${result.conversations.length} chats${result.failures.length ? `, skipped ${result.failures.length}` : ''}`
          : result.failures.length
            ? `Downloaded ${result.conversations.length} chats, skipped ${result.failures.length}`
            : `Downloaded ${result.conversations.length} chats`;
        setProgress(summary, result.conversations.length, result.cancelled || result.failures.length ? 'warning' : 'done');
        activeBackupController = null;
        sendResponse({ message: result.cancelled ? 'backUpAllAsMARKDOWN partial' : 'backUpAllAsMARKDOWN done', ...result, cancelled: result.cancelled });
      })
      .catch((error) => {
        console.error('GPT-BACKUP::ERROR::MARKDOWN', error);
        const wasCancelled = String(error.message || error) === 'Backup stopped by user';
        setProgress(wasCancelled ? 'Backup stopped' : `Backup failed: ${error.message || error}`, 0, wasCancelled ? 'cancelled' : 'error');
        activeBackupController = null;
        sendResponse({ message: wasCancelled ? 'backUpAllAsMARKDOWN stopped' : 'backUpAllAsMARKDOWN failed', error: error.message || String(error), cancelled: wasCancelled });
      });
  }

  if (request.message === 'stopBackup') {
    if (activeBackupController) {
      console.log('GPT-BACKUP::STOP::requested');
      activeBackupController.cancelled = true;
      setProgress('Stopping backup...', 0, 'cancelled');
      sendResponse({ message: 'stopBackup acknowledged', stopping: true });
    } else {
      sendResponse({ message: 'stopBackup idle', stopping: false });
    }
  }

  if (request.message === 'backUpSingleChat') {
    handleSingleUrlId(request.tabs)
      .then(async (conversation) => {
        if (request.downloadType === 'json') {
          await downloadJson(conversation);
        } else {
          await downloadMarkdownZip(conversation, request.userLabel, request.assistantLabel);
        }
        setProgress('Download complete', conversation.length, 'done');
        sendResponse({ message: 'backUpSingleChat done', conversation });
      })
      .catch((error) => {
        console.error(error);
        setProgress(`Backup failed: ${error.message || error}`, 0, 'error');
        sendResponse({ message: 'backUpSingleChat failed', error: error.message || String(error) });
      });
  }
  return true;
});

async function handleSingleUrlId(tabs) {
  const url = tabs[0].url;
  const parsedUrl = new URL(url);
  const pathSegments = parsedUrl.pathname.split('/');
  const conversationId = pathSegments[pathSegments.length - 1];
  const regex = /[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/g;
  const token = await loadToken();
  let id;
  if (!conversationId.match(regex)) {
    const res = await getConversationIds(token);
    id = res.items[0].id;
  } else {
    id = conversationId;
  }
  const rawConversation = await fetchConversation(token, id);
  const conversation = parseConversation(rawConversation);
  return [conversation];
}
async function downloadMarkdownZip(chats, userLabel, assistantLabel) {
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const onlyOneChat = chats.length === 1;
  const enrichedChats = enrichChatsForJson(chats);

  if (onlyOneChat) {
    const title = sanitizeFilename(enrichedChats[0].title || 'untitled');
    const markdown = jsonToMarkdown(enrichedChats[0], userLabel, assistantLabel);
    return saveAs(markdown, 'text/markdown', `${title}.md`);
  }

  const zip = new JSZip();
  const seenNames = new Set();

  for (const chat of enrichedChats) {
    const title = sanitizeFilename(chat.title || 'untitled');
    const filename = dedupeFilename(title, seenNames);
    const markdown = jsonToMarkdown(chat, userLabel, assistantLabel);
    zip.file(`${filename}.md`, markdown);
  }

  const content = await zip.generateAsync({ type: 'base64' });
  return saveAs(content, 'application/zip', `gpt-backup-${dateStr}.zip`);
}
function jsonToMarkdown(
  json,
  userLabel = '<img src="https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png" width="24" alt="User" />',
  assistantLabel = '<img src="https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg" width="24" alt="Assistant" />',
) {
  let output = '';

  for (const message of json.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }

    const label = String(message.role === 'user' ? userLabel : assistantLabel || '').trim();
    const body = message.rendered_markdown || applyContentReferences(
      Array.isArray(message.content)
        ? message.content.filter((part) => part != null && String(part).trim() !== '').join('\n\n')
        : String(message.content || ''),
      message.metadata || {},
    );

    if (!label && !body.trim()) {
      continue;
    }

    const sections = [];
    if (label) sections.push(label);
    if (body.trim()) sections.push(body);

    output += `${sections.join('\n\n')}\n\n---\n\n`;
  }

  return output;
}
async function downloadJson(data) {
  console.log(data);
  if (!data) {
    throw new Error('No data');
  }
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const enrichedData = enrichChatsForJson(data);
  const jsonString = JSON.stringify(enrichedData, null, 2);
  return saveAs(jsonString, 'application/json', `gpt-backup-${dateStr}.json`);
}
