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
  const referenceType = String(reference.type || '');

  if (matchedText.includes('image_group') || referenceType === 'image_group') {
    return safeUrls.map((url, index) => `![Image ${index + 1}](${url})`).join('\n\n');
  }

  if (matchedText.includes('entity') || referenceType === 'entity') {
    const entityMatch = matchedText.match(/entity(.*?)/);
    if (entityMatch) {
      try {
        const parsed = JSON.parse(entityMatch[1]);
        return parsed[1] || parsed[2] || reference.alt || reference.name || matchedText;
      } catch (error) {
        console.warn('GPT-BACKUP::ENTITY::parse-failed', matchedText, error);
      }
    }

    return reference.alt || reference.name || matchedText;
  }

  if (matchedText.includes('filecite') || referenceType === 'file') {
    const fileName = reference.name || reference.alt || reference.id || 'Referenced file';
    const pageStart = reference.page_range_start;
    const pageEnd = reference.page_range_end;
    const pageSuffix = pageStart != null
      ? pageEnd != null && pageEnd !== pageStart
        ? `, pages ${pageStart}-${pageEnd}`
        : `, page ${pageStart}`
      : '';
    const lineStart = reference.input_pointer?.line_range_start;
    const lineEnd = reference.input_pointer?.line_range_end;
    const lineSuffix = lineStart != null
      ? lineEnd != null && lineEnd !== lineStart
        ? `, lines ${lineStart}-${lineEnd}`
        : `, line ${lineStart}`
      : '';
    return `*[Source: ${fileName}${pageSuffix}${lineSuffix}]*`;
  }

  if (safeUrls.length) {
    return safeUrls.join('\n');
  }

  return matchedText;
}

function flattenDirectiveBlocks(text) {
  return String(text || '').replace(
    /:::([a-zA-Z0-9_-]+)(?:\{([^}]*)\})?\n([\s\S]*?)\n:::/g,
    (_match, directiveName, rawAttributes = '', body = '') => {
      const variantMatch = String(rawAttributes).match(/variant="([^"]+)"/);
      const variant = variantMatch?.[1] || null;
      const header = variant
        ? `> **${directiveName} · ${variant}**`
        : `> **${directiveName}**`;
      const quotedBody = String(body)
        .trim()
        .split('\n')
        .map((line) => line.trim() ? `> ${line}` : '>')
        .join('\n');

      return `${header}\n>\n${quotedBody}`.trim();
    },
  );
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

  rendered = flattenDirectiveBlocks(rendered);
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
    .replace(/<img\s+[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '$1 $2')
    .replace(/^>\s?/gm, '');

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

  if (offset === 0 && Array.isArray(json.items)) {
    console.log(`GPT-BACKUP::LIST::conversation-items-sample::${JSON.stringify(json.items.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      keys: Object.keys(item),
      item,
    })))}`);

    const projectLikeItems = json.items.filter((item) => {
      const text = JSON.stringify(item || {});
      return text.includes('g-p-') || text.includes('gizmo') || text.includes('template');
    });

    console.log(`GPT-BACKUP::LIST::project-like-items::${JSON.stringify(projectLikeItems.slice(0, 10).map((item) => ({
      id: item.id,
      title: item.title,
      keys: Object.keys(item),
      item,
    })))}`);
  }

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

async function getAllRawConversations(startOffset, stopOffset, controller) {
  let token = await loadToken();
  let cancelled = false;
  let projectMetadataLogged = false;

  if (isCancelled(controller)) {
    console.log('GPT-BACKUP::CANCELLED::before-initial-raw-conversation-list');
    return { rawConversations: [], failures: [], requested: 0, totalAvailable: 0, cancelled: true };
  }

  const { total, items: allItems } = await getConversationIds(token, startOffset);
  const offsets = generateOffsets(startOffset, total);

  for (const offset of offsets) {
    if (offset === stopOffset) break;

    if (isCancelled(controller)) {
      cancelled = true;
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

  const rawConversations = [];
  const requested = getRequestCount(total, startOffset, stopOffset);
  const failures = [];

  setProgress('Fetching raw chats...', 0, 'running');

  for (const item of allItems) {
    if (isCancelled(controller)) {
      cancelled = true;
      break;
    }
    await sleep(1000);
    if (isCancelled(controller)) {
      cancelled = true;
      break;
    }

    try {
      const rawConversation = await fetchConversation(token, item.id);
      rawConversations.push(rawConversation);
      if (!projectMetadataLogged && (rawConversation?.gizmo_id || rawConversation?.conversation_template_id)) {
        projectMetadataLogged = true;
        console.log(`GPT-BACKUP::RAW::project-metadata-sample::${JSON.stringify({
          title: rawConversation?.title,
          conversation_id: rawConversation?.conversation_id,
          gizmo_id: rawConversation?.gizmo_id,
          gizmo_type: rawConversation?.gizmo_type,
          conversation_template_id: rawConversation?.conversation_template_id,
          topLevelKeys: Object.keys(rawConversation || {}),
        })}`);
      }
      const title = rawConversation?.title || 'untitled';
      const shortTitle = title.length > 20 ? `${title.substring(0, 20)}...` : title;
      setProgress(shortTitle, rawConversations.length, 'running');
    } catch (error) {
      if (String(error.message).includes('(401)')) {
        try {
          token = await loadToken();
          const rawConversation = await fetchConversation(token, item.id);
          rawConversations.push(rawConversation);
          const title = rawConversation?.title || 'untitled';
          const shortTitle = title.length > 20 ? `${title.substring(0, 20)}...` : title;
          setProgress(shortTitle, rawConversations.length, 'running');
          continue;
        } catch (retryError) {
          failures.push({ id: item.id, error: retryError.message || String(retryError) });
        }
      } else {
        failures.push({ id: item.id, error: error.message || String(error) });
      }

      setProgress(`Skipped ${failures.length} chat(s)`, rawConversations.length, 'warning');
    }
  }

  return { rawConversations, failures, requested, totalAvailable: total, cancelled };
}

async function main(startOffset, stopOffset, controller) {
  return getAllConversations(startOffset, stopOffset, controller);
}

async function mainRaw(startOffset, stopOffset, controller) {
  return getAllRawConversations(startOffset, stopOffset, controller);
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
  if (request.message === 'backUpAllAsRAWJSON') {
    console.log('GPT-BACKUP::START::RAWJSON');
    activeBackupController = createCancellationController();
    mainRaw(request.startOffset, request.stopOffset, activeBackupController)
      .then(async (result) => {
        const progressLabel = result.cancelled ? 'Building partial raw JSON file...' : 'Building raw JSON file...';
        setProgress(progressLabel, result.rawConversations.length, result.cancelled ? 'cancelled' : 'running');
        await downloadRawJson(result.rawConversations);
        const summary = result.cancelled
          ? `Stopped and downloaded ${result.rawConversations.length} chats${result.failures.length ? `, skipped ${result.failures.length}` : ''}`
          : result.failures.length
            ? `Downloaded ${result.rawConversations.length} chats, skipped ${result.failures.length}`
            : `Downloaded ${result.rawConversations.length} chats`;
        setProgress(summary, result.rawConversations.length, result.cancelled || result.failures.length ? 'warning' : 'done');
        activeBackupController = null;
        sendResponse({ message: result.cancelled ? 'backUpAllAsRAWJSON partial' : 'backUpAllAsRAWJSON done', ...result, cancelled: result.cancelled });
      })
      .catch((error) => {
        console.error('GPT-BACKUP::ERROR::RAWJSON', error);
        const wasCancelled = String(error.message || error) === 'Backup stopped by user';
        setProgress(wasCancelled ? 'Backup stopped' : `Backup failed: ${error.message || error}`, 0, wasCancelled ? 'cancelled' : 'error');
        activeBackupController = null;
        sendResponse({ message: wasCancelled ? 'backUpAllAsRAWJSON stopped' : 'backUpAllAsRAWJSON failed', error: error.message || String(error), cancelled: wasCancelled });
      });
  }
  if (request.message === 'backUpAllAsMARKDOWN') {
    console.log('GPT-BACKUP::START::MARKDOWN', request);
    activeBackupController = createCancellationController();
    main(request.startOffset, request.stopOffset, activeBackupController)
      .then(async (result) => {
        const progressLabel = result.cancelled ? 'Building partial markdown zip...' : 'Building markdown zip...';
        setProgress(progressLabel, result.conversations.length, result.cancelled ? 'cancelled' : 'running');
        await downloadMarkdownZip(result.conversations, request.userLabel, request.assistantLabel, request.markdownExtension, request.mdxFrontmatter);
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

  if (request.message === 'backUpCurrentProject') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      try {
        const activeTab = tabs[0];
        const projectInfo = parseProjectInfoFromUrl(activeTab.url);
        if (!projectInfo.isProjectChat || !projectInfo.normalizedProjectIdFromSlug) {
          sendResponse({ message: 'backUpCurrentProject failed', error: 'Current tab is not a project chat.' });
          return;
        }

        const { token, id } = await getConversationIdFromTabs(tabs);
        const referenceConversation = await fetchConversation(token, id);
        console.log(`GPT-BACKUP::PROJECT::reference-conversation::${JSON.stringify({
          projectInfo,
          title: referenceConversation?.title,
          conversation_id: referenceConversation?.conversation_id,
          identifiers: extractProjectIdentifiers(referenceConversation),
        })}`);

        const conversationIdsFromDom = await getProjectConversationIdsFromTab(activeTab.id, projectInfo.projectSlug);
        const orderedConversationIds = Array.from(new Set([id, ...conversationIdsFromDom]));
        console.log(`GPT-BACKUP::PROJECT::conversation-ids-from-dom::${JSON.stringify({
          projectSlug: projectInfo.projectSlug,
          conversationIdsFromDom,
          orderedConversationIds,
        })}`);

        activeBackupController = createCancellationController();
        const result = await fetchRawConversationsByIds(token, orderedConversationIds, activeBackupController);
        const filteredRawConversations = filterRawConversationsByProject(result.rawConversations, projectInfo, referenceConversation);
        const fallbackRawConversations = filteredRawConversations.length ? filteredRawConversations : result.rawConversations;
        console.log(`GPT-BACKUP::PROJECT::dom-fetch-result::${JSON.stringify({
          fetched: result.rawConversations.length,
          filtered: filteredRawConversations.length,
          usingFallbackToDomIds: filteredRawConversations.length === 0,
          failures: result.failures,
        })}`);
        const filteredConversations = normalizeRawConversations(fallbackRawConversations);
        const summary = result.cancelled
          ? `Stopped and downloaded ${fallbackRawConversations.length} project chats${result.failures.length ? `, skipped ${result.failures.length}` : ''}`
          : result.failures.length
            ? `Downloaded ${fallbackRawConversations.length} project chats, skipped ${result.failures.length}`
            : `Downloaded ${fallbackRawConversations.length} project chats`;

        if (request.downloadType === 'raw-json') {
          setProgress('Building project raw JSON file...', fallbackRawConversations.length, result.cancelled ? 'cancelled' : 'running');
          await downloadRawJson(fallbackRawConversations);
          sendResponse({ message: 'backUpCurrentProject done', rawConversations: fallbackRawConversations, failures: result.failures, cancelled: result.cancelled, projectInfo });
        } else if (request.downloadType === 'json') {
          setProgress('Building project JSON file...', filteredConversations.length, result.cancelled ? 'cancelled' : 'running');
          await downloadJson(filteredConversations);
          sendResponse({ message: 'backUpCurrentProject done', conversations: filteredConversations, failures: result.failures, cancelled: result.cancelled, projectInfo });
        } else {
          setProgress('Building project markdown zip...', filteredConversations.length, result.cancelled ? 'cancelled' : 'running');
          await downloadMarkdownZip(filteredConversations, request.userLabel, request.assistantLabel, request.markdownExtension, request.mdxFrontmatter);
          sendResponse({ message: 'backUpCurrentProject done', conversations: filteredConversations, failures: result.failures, cancelled: result.cancelled, projectInfo });
        }

        setProgress(summary, fallbackRawConversations.length, result.cancelled || result.failures.length ? 'warning' : 'done');
        activeBackupController = null;
      } catch (error) {
        console.error('GPT-BACKUP::ERROR::PROJECT', error);
        activeBackupController = null;
        setProgress(`Backup failed: ${error.message || error}`, 0, 'error');
        sendResponse({ message: 'backUpCurrentProject failed', error: error.message || String(error) });
      }
    });
  }

  if (request.message === 'backUpSingleChat') {
    const action = request.downloadType === 'raw-json'
      ? handleSingleRawUrlId(request.tabs).then(async (rawConversation) => {
          await downloadRawJson(rawConversation);
          setProgress('Download complete', rawConversation.length, 'done');
          sendResponse({ message: 'backUpSingleChat done', rawConversation });
        })
      : handleSingleUrlId(request.tabs).then(async (conversation) => {
          if (request.downloadType === 'json') {
            await downloadJson(conversation);
          } else {
            await downloadMarkdownZip(conversation, request.userLabel, request.assistantLabel, request.markdownExtension, request.mdxFrontmatter);
          }
          setProgress('Download complete', conversation.length, 'done');
          sendResponse({ message: 'backUpSingleChat done', conversation });
        });

    action.catch((error) => {
      console.error(error);
      setProgress(`Backup failed: ${error.message || error}`, 0, 'error');
      sendResponse({ message: 'backUpSingleChat failed', error: error.message || String(error) });
    });
  }
  return true;
});

function parseProjectInfoFromUrl(url) {
  const parsedUrl = new URL(url);
  const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
  const gIndex = pathSegments.indexOf('g');
  const cIndex = pathSegments.indexOf('c');

  const projectSlug = gIndex !== -1 ? pathSegments[gIndex + 1] || null : null;
  const conversationId = cIndex !== -1 ? pathSegments[cIndex + 1] || null : pathSegments[pathSegments.length - 1] || null;
  const normalizedProjectIdFromSlug = projectSlug?.match(/(g-p-[a-z0-9]+)/)?.[1] || null;

  return {
    pathname: parsedUrl.pathname,
    pathSegments,
    projectSlug,
    normalizedProjectIdFromSlug,
    conversationId,
    isProjectChat: gIndex !== -1 && cIndex !== -1,
  };
}

async function getConversationIdFromTabs(tabs) {
  const url = tabs[0].url;
  const projectInfo = parseProjectInfoFromUrl(url);
  const conversationId = projectInfo.conversationId;
  const regex = /[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/g;
  const token = await loadToken();

  console.log(`GPT-BACKUP::URL::project-info::${JSON.stringify(projectInfo)}`);

  if (!conversationId || !conversationId.match(regex)) {
    const res = await getConversationIds(token);
    return { token, id: res.items[0].id, projectInfo };
  }

  return { token, id: conversationId, projectInfo };
}

async function ensureProjectContentScript(tabId) {
  try {
    return await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { message: 'getCurrentProjectConversationIds', projectSlug: '__ping__' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    });
  } catch (error) {
    console.log(`GPT-BACKUP::PROJECT::content-script-missing::${JSON.stringify({ tabId, error: error.message || String(error) })}`);
    throw new Error('Please reload the ChatGPT tab and try the project backup again.');
  }
}

async function getProjectConversationIdsFromTab(tabId, projectSlug) {
  await ensureProjectContentScript(tabId);

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { message: 'getCurrentProjectConversationIds', projectSlug }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response?.error) {
        reject(new Error(response.error));
        return;
      }

      resolve(Array.isArray(response?.conversationIds) ? response.conversationIds : []);
    });
  });
}

async function fetchRawConversationsByIds(token, conversationIds, controller) {
  const rawConversations = [];
  const failures = [];
  let cancelled = false;

  setProgress('Fetching project chats...', 0, 'running');

  for (const id of conversationIds) {
    if (isCancelled(controller)) {
      cancelled = true;
      break;
    }

    await sleep(1000);
    if (isCancelled(controller)) {
      cancelled = true;
      break;
    }

    try {
      const rawConversation = await fetchConversation(token, id);
      rawConversations.push(rawConversation);
      const title = rawConversation?.title || 'untitled';
      const shortTitle = title.length > 20 ? `${title.substring(0, 20)}...` : title;
      setProgress(shortTitle, rawConversations.length, 'running');
    } catch (error) {
      failures.push({ id, error: error.message || String(error) });
      setProgress(`Skipped ${failures.length} project chat(s)`, rawConversations.length, 'warning');
    }
  }

  return { rawConversations, failures, cancelled };
}

async function handleSingleUrlId(tabs) {
  const { token, id } = await getConversationIdFromTabs(tabs);
  const rawConversation = await fetchConversation(token, id);
  const conversation = parseConversation(rawConversation);
  return [conversation];
}

async function handleSingleRawUrlId(tabs) {
  const { token, id, projectInfo } = await getConversationIdFromTabs(tabs);
  const rawConversation = await fetchConversation(token, id);
  console.log(`GPT-BACKUP::RAW::single-chat-project-context::${JSON.stringify({
    projectInfo,
    conversationTopLevelKeys: Object.keys(rawConversation || {}),
    current_node: rawConversation?.current_node,
    conversation_id: rawConversation?.conversation_id,
    conversation_template_id: rawConversation?.conversation_template_id,
    gizmo_id: rawConversation?.gizmo_id,
    gizmo_type: rawConversation?.gizmo_type,
    default_model_slug: rawConversation?.default_model_slug,
    safe_urls_count: Array.isArray(rawConversation?.safe_urls) ? rawConversation.safe_urls.length : 0,
    projectIdentifiers: extractProjectIdentifiers(rawConversation),
  })}`);

  console.log(`GPT-BACKUP::RAW::single-chat-project-summary::${JSON.stringify({
    title: rawConversation?.title,
    projectSlug: projectInfo?.projectSlug,
    normalizedProjectIdFromSlug: projectInfo?.projectSlug?.match(/(g-p-[a-z0-9]+)/)?.[1] || null,
    gizmo_id: rawConversation?.gizmo_id,
    conversation_template_id: rawConversation?.conversation_template_id,
    sameProjectId: (projectInfo?.projectSlug?.match(/(g-p-[a-z0-9]+)/)?.[1] || null) === rawConversation?.gizmo_id,
  })}`);
  return [rawConversation];
}

function collectStringValuesByKey(value, keyNames, results = new Set(), seen = new WeakSet()) {
  if (!value || typeof value !== 'object') {
    return results;
  }

  if (seen.has(value)) {
    return results;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectStringValuesByKey(item, keyNames, results, seen));
    return results;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (keyNames.has(key) && typeof nestedValue === 'string' && nestedValue.trim()) {
      results.add(nestedValue.trim());
    }

    if (nestedValue && typeof nestedValue === 'object') {
      collectStringValuesByKey(nestedValue, keyNames, results, seen);
    }
  }

  return results;
}

function extractProjectIdentifiers(rawConversation) {
  const keyNames = new Set([
    'gizmo_id',
    'conversation_template_id',
    'project_id',
    'workspace_id',
    'assistant_id',
    'gizmoId',
    'conversationTemplateId',
    'projectId',
    'workspaceId',
    'assistantId',
  ]);

  return Array.from(collectStringValuesByKey(rawConversation, keyNames)).sort();
}

function applyMdxFrontmatter(markdown, title, markdownExtension = '.md', mdxFrontmatter = '---\ntitle: "{{title}}"\n---') {
  if (markdownExtension !== '.mdx') {
    return markdown;
  }

  const frontmatter = String(mdxFrontmatter || '').replaceAll('{{title}}', String(title || 'untitled'));
  const normalizedFrontmatter = frontmatter.trim() ? `${frontmatter.trim()}\n\n` : '';
  return `${normalizedFrontmatter}${markdown}`;
}

function filterRawConversationsByProject(rawConversations, projectInfo, referenceConversation = null) {
  const projectCandidates = new Set([
    projectInfo?.normalizedProjectIdFromSlug,
    projectInfo?.projectSlug,
    ...(referenceConversation ? extractProjectIdentifiers(referenceConversation) : []),
  ].filter(Boolean));

  console.log(`GPT-BACKUP::PROJECT::filter-candidates::${JSON.stringify(Array.from(projectCandidates))}`);

  const filtered = rawConversations.filter((conversation) => {
    const identifiers = extractProjectIdentifiers(conversation);
    return identifiers.some((identifier) => projectCandidates.has(identifier));
  });

  console.log(`GPT-BACKUP::PROJECT::filter-result::${JSON.stringify({
    totalRawConversations: rawConversations.length,
    matched: filtered.length,
    unmatchedSample: rawConversations.slice(0, 5).map((conversation) => ({
      title: conversation?.title,
      conversation_id: conversation?.conversation_id,
      identifiers: extractProjectIdentifiers(conversation),
    })),
    matchedSample: filtered.slice(0, 5).map((conversation) => ({
      title: conversation?.title,
      conversation_id: conversation?.conversation_id,
      identifiers: extractProjectIdentifiers(conversation),
    })),
  })}`);

  return filtered;
}

function normalizeRawConversations(rawConversations) {
  return rawConversations.map((rawConversation) => parseConversation(rawConversation));
}

async function downloadMarkdownZip(chats, userLabel, assistantLabel, markdownExtension = '.md', mdxFrontmatter = '---\ntitle: "{{title}}"\n---') {
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const onlyOneChat = chats.length === 1;
  const enrichedChats = enrichChatsForJson(chats);

  if (onlyOneChat) {
    const title = sanitizeFilename(enrichedChats[0].title || 'untitled');
    const markdown = applyMdxFrontmatter(
      jsonToMarkdown(enrichedChats[0], userLabel, assistantLabel),
      enrichedChats[0].title || 'untitled',
      markdownExtension,
      mdxFrontmatter,
    );
    return saveAs(markdown, 'text/markdown', `${title}${markdownExtension}`);
  }

  const zip = new JSZip();
  const seenNames = new Set();

  for (const chat of enrichedChats) {
    const title = sanitizeFilename(chat.title || 'untitled');
    const filename = dedupeFilename(title, seenNames);
    const markdown = applyMdxFrontmatter(
      jsonToMarkdown(chat, userLabel, assistantLabel),
      chat.title || 'untitled',
      markdownExtension,
      mdxFrontmatter,
    );
    zip.file(`${filename}${markdownExtension}`, markdown);
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

async function downloadRawJson(data) {
  console.log(data);
  if (!data) {
    throw new Error('No raw data');
  }
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonString = JSON.stringify(data, null, 2);
  return saveAs(jsonString, 'application/json', `gpt-backup-raw-${dateStr}.json`);
}
