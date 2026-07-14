import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

type CancellationController = { cancelled: boolean };
type AnyRecord = Record<string, unknown>;
type DownloadType = 'json' | 'raw-json' | 'markdown';
type MarkdownExtension = '.md' | '.mdx';
type ProgressStatus = 'idle' | 'running' | 'warning' | 'done' | 'cancelled' | 'error';
type ProgressPort = chrome.runtime.Port;

type MarkdownSettings = {
  userLabel: string;
  assistantLabel: string;
  markdownExtension: MarkdownExtension;
  mdxFrontmatter: string;
};

type ImageAssetReference = {
  fileId: string;
  assetPointer: string;
  name?: string;
};

type NormalizedMessage = {
  role: 'user' | 'assistant';
  content: string[];
  model: string | null;
  create_time?: number;
  metadata: AnyRecord;
  contentType: string | null;
  images?: ImageAssetReference[];
  rendered_markdown?: string;
  rendered_text?: string;
};

type ParsedConversation = {
  messages: NormalizedMessage[];
  create_time?: number;
  title?: string;
  conversation_id?: string;
  images?: ImageAssetReference[];
};

type ChatGptConversationListItem = {
  id: string;
  title?: string;
  offset: number;
  [key: string]: unknown;
};

type ChatGptConversationListResponse = {
  items: ChatGptConversationListItem[];
  total: number;
};

type ChatGptRawConversation = {
  title?: string;
  create_time?: number;
  conversation_id?: string;
  gizmo_id?: string;
  gizmo_type?: string;
  conversation_template_id?: string;
  mapping?: Record<string, {
    message?: {
      id?: string;
      author?: { role?: string };
      content?: {
        parts?: unknown[];
        text?: unknown;
        content_type?: string;
        contentType?: string;
        [key: string]: unknown;
      };
      metadata?: AnyRecord;
      create_time?: number;
    };
  }>;
  [key: string]: unknown;
};

type BackupFailure = { id: string; error: string };
type ConversationBackupResult = { conversations: ParsedConversation[]; failures: BackupFailure[]; requested: number; totalAvailable: number; cancelled: boolean };
type RawConversationBackupResult = { rawConversations: ChatGptRawConversation[]; failures: BackupFailure[]; requested?: number; totalAvailable?: number; cancelled: boolean };

type ProjectInfo = {
  pathname: string;
  pathSegments: string[];
  projectSlug: string | null;
  normalizedProjectIdFromSlug: string | null;
  conversationId: string | null;
  isProjectChat: boolean;
};

type DownloadTimingSettings = { secondsBetweenChatDownloads?: number };
type BackupAllRequest = { message: 'backUpAllAsJSON' | 'backUpAllAsRAWJSON'; startOffset: number; stopOffset: number } & DownloadTimingSettings;
type BackupAllMarkdownRequest = { message: 'backUpAllAsMARKDOWN'; startOffset: number; stopOffset: number; autoAdvanceStartOffset?: boolean } & MarkdownSettings & DownloadTimingSettings;
type StopBackupRequest = { message: 'stopBackup' };
type ColorSchemeRequest = { message: 'getColorScheme'; colorScheme: 'dark' | 'light' | string };
type BackupProjectRequest = { message: 'backUpCurrentProject'; downloadType: DownloadType; startOffset: number; stopOffset: number } & Partial<MarkdownSettings> & DownloadTimingSettings;
type BackupSingleChatRequest = { message: 'backUpSingleChat'; tabs: chrome.tabs.Tab[]; downloadType: DownloadType; includeImages?: boolean } & Partial<MarkdownSettings>;
type BackgroundRequest = ColorSchemeRequest | BackupAllRequest | BackupAllMarkdownRequest | StopBackupRequest | BackupProjectRequest | BackupSingleChatRequest;

export default defineBackground(() => {
const DEBUG = false;
const debugLog = (...args: unknown[]) => { if (DEBUG) console.log(...args); };
const debugWarn = (...args: unknown[]) => { if (DEBUG) console.warn(...args); };
const debugError = (...args: unknown[]) => { if (DEBUG) console.error(...args); };
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const conversationListLimit = 50;
const markdownBackupRecoveryStorageKey = 'markdownBackupRecovery';
const fetchTimeoutMs = 30000;

function getNextConversationListOffset(startOffset: number, loadedCount: number) {
  return startOffset + loadedCount;
}

function sleep(ms = 1000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number) {
  return Math.min(5000 * attempt, 30000);
}

function isTransientFetchError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    error instanceof TypeError ||
    error instanceof DOMException ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('aborted')
  );
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = fetchTimeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`Fetch timed out after ${timeoutMs}ms`)), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal || controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getChatDownloadDelayMs(secondsBetweenChatDownloads?: number) {
  const seconds = Number(secondsBetweenChatDownloads ?? 2);
  return Math.max(0, seconds) * 1000;
}

async function setSyncStorage(values: Record<string, unknown>, maxAttempts = 3, attempt = 1): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.storage.sync.set(values, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  } catch (error) {
    if (attempt < maxAttempts) {
      await sleep(500 * attempt);
      return setSyncStorage(values, maxAttempts, attempt + 1);
    }

    throw error;
  }
}

function setLocalStorage(values: Record<string, unknown>) {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function setMarkdownBackupRecovery(values: Record<string, unknown>) {
  return setLocalStorage({
    [markdownBackupRecoveryStorageKey]: {
      ...values,
      updatedAt: new Date().toISOString(),
    },
  });
}

function getProgressMessage(text: string, completed: number, status: ProgressStatus = 'running', targetTotal?: number) {
  return { text, total: completed, completed, targetTotal, status, activeBackup: Boolean(activeBackupController && status === 'running') };
}

function setProgress(text: string, completed: number, status: ProgressStatus = 'running', targetTotal?: number) {
  progressState = getProgressMessage(text, completed, status, targetTotal);
  ports.forEach((port) => port.postMessage(progressState));
}

function createCancellationController(): CancellationController {
  return { cancelled: false };
}

function isCancelled(controller?: CancellationController | null) {
  return Boolean(controller?.cancelled);
}

function sanitizeFilename(name = 'untitled'): string {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

function dedupeFilename(baseName: string, seenNames: Set<string>): string {
  let candidate = baseName;
  let counter = 2;

  while (seenNames.has(candidate)) {
    candidate = `${baseName} (${counter})`;
    counter += 1;
  }

  seenNames.add(candidate);
  return candidate;
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getReferenceReplacement(reference: AnyRecord): string {
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
        return String(parsed[1] || parsed[2] || reference.alt || reference.name || matchedText);
      } catch (error) {
        debugWarn('GPT-BACKUP::ENTITY::parse-failed', matchedText, error);
      }
    }

    return String(reference.alt || reference.name || matchedText);
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
    const inputPointer = reference.input_pointer && typeof reference.input_pointer === 'object'
      ? reference.input_pointer as AnyRecord
      : {};
    const lineStart = inputPointer.line_range_start;
    const lineEnd = inputPointer.line_range_end;
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

function flattenDirectiveBlocks(text: string): string {
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

function applyContentReferences(text: string, metadata: AnyRecord = {}): string {
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

function enrichMessage(message: NormalizedMessage): NormalizedMessage {
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

function enrichChatsForJson(chats: ParsedConversation[]): ParsedConversation[] {
  return chats.map((chat) => ({
    ...chat,
    messages: Array.isArray(chat.messages) ? chat.messages.map(enrichMessage) : [],
  }));
}

function getImageReferenceName(image: ImageAssetReference, metadata: AnyRecord): string | undefined {
  const attachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  const attachment = attachments.find((item) => {
    if (!item || typeof item !== 'object') return false;
    return (item as AnyRecord).id === image.fileId;
  }) as AnyRecord | undefined;

  if (typeof attachment?.name === 'string' && attachment.name.trim()) {
    return attachment.name.trim();
  }

  if (typeof metadata.image_gen_title === 'string' && metadata.image_gen_title.trim()) {
    return metadata.image_gen_title.trim();
  }

  if (typeof metadata.async_task_title === 'string' && metadata.async_task_title.trim()) {
    return metadata.async_task_title.trim();
  }

  return undefined;
}

function findImageAssetReferences(parts: unknown[]): ImageAssetReference[] {
  const images: ImageAssetReference[] = [];
  const seenFileIds = new Set<string>();

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;

    const candidate = part as AnyRecord;
    if (
      candidate.content_type !== 'image_asset_pointer' ||
      typeof candidate.asset_pointer !== 'string'
    ) {
      continue;
    }

    const assetPointer = candidate.asset_pointer;
    const fileId = assetPointer.replace(/^sediment:\/\//, '');
    if (!fileId || seenFileIds.has(fileId)) continue;

    seenFileIds.add(fileId);
    images.push({ fileId, assetPointer });
  }

  return images;
}

function parseConversation(rawConversation: ChatGptRawConversation): ParsedConversation {
  const title = rawConversation?.title;
  const create_time = rawConversation?.create_time;
  const conversation_id = rawConversation?.conversation_id;
  const mapping = rawConversation?.mapping || {};
  const keys = Object.keys(mapping);
  const messages: NormalizedMessage[] = [];
  const conversationImages: ImageAssetReference[] = [];
  const seenConversationImageFileIds = new Set<string>();

  debugLog('GPT-BACKUP::PARSE::conversation', {
    title,
    create_time,
    mappingKeys: keys.length,
  });

  for (const k of keys) {
    const msgPayload = mapping[k];
    const msg = msgPayload?.message;
    if (!msg) continue;

    const rawRole = msg.author?.role;
    const rawContent = msg.content;
    const parts = Array.isArray(rawContent?.parts)
      ? rawContent.parts
      : rawContent?.text != null
        ? [String(rawContent.text)]
        : [];
    const images = findImageAssetReferences(parts);
    const role = rawRole === 'tool' && images.length ? 'assistant' : rawRole;
    if (role !== 'user' && role !== 'assistant') continue;

    const metadata = msg.metadata || {};
    const namedImages = images.map((image) => ({
      ...image,
      ...(getImageReferenceName(image, metadata) ? { name: getImageReferenceName(image, metadata) } : {}),
    }));
    const contentType = rawContent?.content_type || rawContent?.contentType || null;

    const recipient = (msg as AnyRecord).recipient;
    if (role === 'assistant' && contentType === 'code' && recipient !== 'all') continue;

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
      debugLog('GPT-BACKUP::PARSE::assistant-rich-content', {
        title,
        messageId: msg.id,
        contentType,
        metadataKeys: Object.keys(metadata || {}),
        rawContent,
        metadata,
      });
    }

    const content = parts
      .filter((part) => {
        if (part == null) return false;
        if (typeof part !== 'object') return true;
        return (part as AnyRecord).content_type !== 'image_asset_pointer';
      })
      .map((part) => typeof part === 'string' ? part : JSON.stringify(part));

    if (!content.length && !images.length) continue;

    const model = typeof msg.metadata?.model_slug === 'string' ? msg.metadata.model_slug : null;
    const messageCreateTime = msg.create_time;

    for (const image of namedImages) {
      if (seenConversationImageFileIds.has(image.fileId)) continue;
      seenConversationImageFileIds.add(image.fileId);
      conversationImages.push(image);
    }

    messages.push({
      role,
      content,
      model,
      create_time: messageCreateTime,
      metadata,
      contentType: typeof contentType === 'string' ? contentType : null,
      ...(namedImages.length ? { images: namedImages } : {}),
    });
  }

  messages.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));

  return {
    messages,
    create_time,
    title,
    conversation_id,
    ...(conversationImages.length ? { images: conversationImages } : {}),
  };
}

function getRequestCount(total: number, startOffset: number, stopOffset: number): number {
  if (stopOffset === -1) return Math.max(0, total - startOffset);

  return Math.max(0, stopOffset - startOffset);
}

function logProgress(total: number, messages: number, offset: number) {
  const progress = Math.round((messages / total) * 100);
  debugLog(`GPT-BACKUP::PROGRESS::${progress}%::OFFSET::${offset}`);
}

async function fetchConversationListPage(token: string, offset: number): Promise<ChatGptConversationListResponse> {
  try {
    return await getConversationIds(token, offset);
  } catch (error) {
    if (getErrorMessage(error).includes('(401)')) {
      const refreshedToken = await loadToken();
      return getConversationIds(refreshedToken, offset);
    }

    throw error;
  }
}

async function fetchParsedConversationWithTokenRefresh(token: string, id: string): Promise<{ token: string; conversation: ParsedConversation }> {
  try {
    return { token, conversation: parseConversation(await fetchConversation(token, id)) };
  } catch (error) {
    if (getErrorMessage(error).includes('(401)')) {
      const refreshedToken = await loadToken();
      return { token: refreshedToken, conversation: parseConversation(await fetchConversation(refreshedToken, id)) };
    }

    throw error;
  }
}

let accessTokenMemoryCache: string | null = null;

function clearTokenCache() {
  accessTokenMemoryCache = null;
}

async function loadToken(): Promise<string> {
  if (accessTokenMemoryCache) return accessTokenMemoryCache;

  const res = await fetchWithTimeout('https://chatgpt.com/api/auth/session');
  if (res.ok) {
    const accessToken = (await res.json()).accessToken;
    accessTokenMemoryCache = accessToken;
    return accessToken;
  }
  return Promise.reject('failed to fetch token');
}

async function getConversationIds(token: string, offset = 0, maxAttempts = 5, attempt = 1): Promise<ChatGptConversationListResponse> {
  let res: Response;

  try {
    res = await fetchWithTimeout(
      `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=${conversationListLimit}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );
  } catch (error) {
    const exceeded = attempt >= maxAttempts;
    if (isTransientFetchError(error) && !exceeded) {
      await sleep(getRetryDelayMs(attempt));
      return getConversationIds(token, offset, maxAttempts, attempt + 1);
    }

    throw error;
  }

  if (!res.ok) {
    const exceeded = attempt >= maxAttempts;
    if (res.status === 401) {
      clearTokenCache();
    }

    if ((res.status === 429 || res.status >= 500) && !exceeded) {
      await sleep(getRetryDelayMs(attempt));
      return getConversationIds(token, offset, maxAttempts, attempt + 1);
    }

    throw new Error(`failed to fetch conversation ids (${res.status})`);
  }

  const json = await res.json() as Omit<ChatGptConversationListResponse, 'items'> & { items: Array<Omit<ChatGptConversationListItem, 'offset'>> };

  if (offset === 0 && Array.isArray(json.items)) {
    debugLog(`GPT-BACKUP::LIST::conversation-items-sample::${JSON.stringify(json.items.slice(0, 5).map((item: Omit<ChatGptConversationListItem, 'offset'>) => ({
      id: item.id,
      title: item.title,
      keys: Object.keys(item),
      item,
    })))}`);

    const projectLikeItems = json.items.filter((item: Omit<ChatGptConversationListItem, 'offset'>) => {
      const text = JSON.stringify(item || {});
      return text.includes('g-p-') || text.includes('gizmo') || text.includes('template');
    });

    debugLog(`GPT-BACKUP::LIST::project-like-items::${JSON.stringify(projectLikeItems.slice(0, 10).map((item: Omit<ChatGptConversationListItem, 'offset'>) => ({
      id: item.id,
      title: item.title,
      keys: Object.keys(item),
      item,
    })))}`);
  }

  return {
    items: json.items.map((item: Omit<ChatGptConversationListItem, 'offset'>) => ({ ...(item as ChatGptConversationListItem), offset })),
    total: json.total,
  };
}

async function fetchConversation(token: string, id: string, maxAttempts = 5, attempt = 1): Promise<ChatGptRawConversation> {
  let res: Response;

  try {
    res = await fetchWithTimeout(
      `https://chatgpt.com/backend-api/conversation/${id}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );
  } catch (error) {
    const exceeded = attempt >= maxAttempts;
    if (isTransientFetchError(error) && !exceeded) {
      await sleep(getRetryDelayMs(attempt));
      return fetchConversation(token, id, maxAttempts, attempt + 1);
    }

    throw error;
  }

  if (!res.ok) {
    const exceeded = attempt >= maxAttempts;
    if (res.status === 401) {
      clearTokenCache();
      throw new Error('failed to fetch conversation (401)');
    }

    if ((res.status === 429 || res.status >= 500) && !exceeded) {
      await sleep(getRetryDelayMs(attempt));
      return fetchConversation(token, id, maxAttempts, attempt + 1);
    }

    throw new Error(`failed to fetch conversation (${res.status})`);
  }

  return res.json();
}

async function getAllConversations(
  startOffset: number,
  stopOffset: number,
  controller: CancellationController,
  chatDownloadDelayMs = getChatDownloadDelayMs(),
  onConversation?: (conversation: ParsedConversation, completed: number, requested: number) => Promise<void>,
): Promise<ConversationBackupResult> {
  let token = await loadToken();
  let cancelled = false;

  if (isCancelled(controller)) {
    debugLog('GPT-BACKUP::CANCELLED::before-initial-conversation-list');
    return { conversations: [], failures: [], requested: 0, totalAvailable: 0, cancelled: true };
  }

  const { total, items: firstItems } = await getConversationIds(token, startOffset);
  setProgress(`ChatGPT reports ${total} total chats`, 0, 'running', total);

  const requested = getRequestCount(total, startOffset, stopOffset);
  const allConversations: ParsedConversation[] = [];
  const failures: BackupFailure[] = [];
  let currentItems = firstItems;
  let loadedListCount = firstItems.length;
  let nextOffset = getNextConversationListOffset(startOffset, loadedListCount);

  debugLog(`GPT-BACKUP::STARTING::REQUESTED-MESSAGES::${requested}`);
  debugLog(`GPT-BACKUP::STARTING::TOTAL-MESSAGES::${total}`);
  setProgress('Fetching chats...', 0, 'running', requested);

  while (currentItems.length && allConversations.length + failures.length < requested) {
    const remaining = requested - allConversations.length - failures.length;
    const itemsToFetch = currentItems.slice(0, remaining);

    for (const item of itemsToFetch) {
      if (isCancelled(controller)) {
        cancelled = true;
        debugLog(`GPT-BACKUP::CANCELLED::before-conversation-fetch::fetched=${allConversations.length}`);
        break;
      }
      await sleep(chatDownloadDelayMs);
      if (isCancelled(controller)) {
        cancelled = true;
        debugLog(`GPT-BACKUP::CANCELLED::after-wait-before-conversation-fetch::fetched=${allConversations.length}`);
        break;
      }

      if (allConversations.length % 20 === 0) {
        logProgress(requested, allConversations.length, item.offset);
      }

      try {
        const result = await fetchParsedConversationWithTokenRefresh(token, item.id);
        token = result.token;
        const conversation = result.conversation;
        allConversations.push(conversation);
        const title = conversation.title || 'untitled';
        const shortTitle = title.length > 20 ? `${title.substring(0, 20)}...` : title;
        setProgress(shortTitle, allConversations.length, 'running', requested);
        await onConversation?.(conversation, allConversations.length, requested);
      } catch (error) {
        failures.push({ id: item.id, error: getErrorMessage(error) });
        debugWarn('Skipping conversation', item.id, failures[failures.length - 1]);
        setProgress(`Skipped ${failures.length} chat(s)`, allConversations.length + failures.length, 'warning', requested);
      }
    }

    if (cancelled || allConversations.length + failures.length >= requested) break;
    if (stopOffset !== -1 && nextOffset >= stopOffset) break;

    setProgress(`Loading more chat IDs (${allConversations.length + failures.length}/${requested})...`, allConversations.length + failures.length, 'running', requested);
    await sleep();

    const { items } = await fetchConversationListPage(token, nextOffset);
    if (!items.length) break;
    currentItems = items;
    loadedListCount += items.length;
    nextOffset = getNextConversationListOffset(startOffset, loadedListCount);
  }

  if (!allConversations.length && failures.length) {
    const firstFailure = failures[0];
    throw new Error(`No chats could be downloaded. First failure: ${firstFailure.error}`);
    }

  logProgress(requested, allConversations.length, nextOffset);

  return { conversations: allConversations, failures, requested, totalAvailable: total, cancelled };
}

async function getAllRawConversations(startOffset: number, stopOffset: number, controller: CancellationController, chatDownloadDelayMs = getChatDownloadDelayMs()): Promise<RawConversationBackupResult> {
  let token = await loadToken();
  let cancelled = false;
  let projectMetadataLogged = false;

  if (isCancelled(controller)) {
    debugLog('GPT-BACKUP::CANCELLED::before-initial-raw-conversation-list');
    return { rawConversations: [], failures: [], requested: 0, totalAvailable: 0, cancelled: true };
  }

  const { total, items: allItems } = await getConversationIds(token, startOffset);
  setProgress(`ChatGPT reports ${total} total chats`, 0, 'running', total);
  const requested = getRequestCount(total, startOffset, stopOffset);

  while (stopOffset === -1 || allItems.length < requested) {
    const offset = getNextConversationListOffset(startOffset, allItems.length);
    if (stopOffset !== -1 && offset >= stopOffset) break;

    if (isCancelled(controller)) {
      cancelled = true;
      break;
    }
    await sleep();

    try {
      const { items } = await getConversationIds(token, offset);
      if (!items.length) break;
      allItems.push.apply(allItems, items);
    } catch (error) {
      if (getErrorMessage(error).includes('(401)')) {
        token = await loadToken();
        const { items } = await getConversationIds(token, offset);
        if (!items.length) break;
        allItems.push.apply(allItems, items);
      } else {
        throw error;
      }
    }
  }

  const rawConversations: ChatGptRawConversation[] = [];
  const itemsToFetch = stopOffset === -1 ? allItems : allItems.slice(0, requested);
  const failures: BackupFailure[] = [];

  setProgress('Fetching raw chats...', 0, 'running', requested);

  for (const item of itemsToFetch) {
    if (isCancelled(controller)) {
      cancelled = true;
      break;
    }
    await sleep(chatDownloadDelayMs);
    if (isCancelled(controller)) {
      cancelled = true;
      break;
    }

    try {
      const rawConversation = await fetchConversation(token, item.id);
      rawConversations.push(rawConversation);
      if (!projectMetadataLogged && (rawConversation?.gizmo_id || rawConversation?.conversation_template_id)) {
        projectMetadataLogged = true;
        debugLog(`GPT-BACKUP::RAW::project-metadata-sample::${JSON.stringify({
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
      setProgress(shortTitle, rawConversations.length, 'running', requested);
    } catch (error) {
      if (getErrorMessage(error).includes('(401)')) {
        try {
          token = await loadToken();
          const rawConversation = await fetchConversation(token, item.id);
          rawConversations.push(rawConversation);
          const title = rawConversation?.title || 'untitled';
          const shortTitle = title.length > 20 ? `${title.substring(0, 20)}...` : title;
          setProgress(shortTitle, rawConversations.length, 'running', requested);
          continue;
        } catch (retryError) {
          failures.push({ id: item.id, error: getErrorMessage(retryError) });
        }
      } else {
        failures.push({ id: item.id, error: getErrorMessage(error) });
      }

      setProgress(`Skipped ${failures.length} chat(s)`, rawConversations.length + failures.length, 'warning', requested);
    }
  }

  return { rawConversations, failures, requested, totalAvailable: total, cancelled };
}

async function main(
  startOffset: number,
  stopOffset: number,
  controller: CancellationController,
  secondsBetweenChatDownloads?: number,
  onConversation?: (conversation: ParsedConversation, completed: number, requested: number) => Promise<void>,
): Promise<ConversationBackupResult> {
  return getAllConversations(startOffset, stopOffset, controller, getChatDownloadDelayMs(secondsBetweenChatDownloads), onConversation);
}

async function mainRaw(startOffset: number, stopOffset: number, controller: CancellationController, secondsBetweenChatDownloads?: number): Promise<RawConversationBackupResult> {
  return getAllRawConversations(startOffset, stopOffset, controller, getChatDownloadDelayMs(secondsBetweenChatDownloads));
}

let activeBackupController: CancellationController | null = null;
let progressState = getProgressMessage('', 0, 'idle');
const ports = new Set<ProgressPort>();
chrome.runtime.onConnect.addListener(function (port) {
  console.assert(port.name == 'progress');
  ports.add(port);
  port.postMessage({ ...progressState, activeBackup: Boolean(activeBackupController && progressState.status === 'running') });
  port.onDisconnect.addListener(function () {
    ports.delete(port);
  });
});
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...Array.from(chunk));
  }

  return btoa(binary);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const base64Data = bytesToBase64(new Uint8Array(arrayBuffer));
  return `data:${blob.type || 'application/octet-stream'};base64,${base64Data}`;
}

async function saveAs(content: string | Blob = '', fileType = 'text/plain', filename = 'file.txt', promptForLocation = true) {
  let dataUrl: string | null = null;
  let shouldRevokeObjectUrl = false;
  const blob = content instanceof Blob ? content : new Blob([content], { type: fileType });

  try {
    if (typeof URL?.createObjectURL === 'function') {
      dataUrl = URL.createObjectURL(blob);
      shouldRevokeObjectUrl = true;
    } else {
      dataUrl = await blobToDataUrl(blob);
    }
  } catch (error) {
    debugWarn('Falling back to data URL download', error);
    dataUrl = await blobToDataUrl(blob);
    shouldRevokeObjectUrl = false;
  }

  return new Promise((resolve, reject) => {
    if (!dataUrl) {
      reject(new Error('Failed to create download URL'));
      return;
    }

    chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: promptForLocation,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        if (shouldRevokeObjectUrl) {
          URL.revokeObjectURL(dataUrl);
        }
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      debugLog('Download initiated with ID:', downloadId);

      if (!shouldRevokeObjectUrl) {
        resolve(downloadId);
        return;
      }

      const onChanged = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id !== downloadId || (delta.state?.current !== 'complete' && delta.state?.current !== 'interrupted')) {
          return;
        }

        URL.revokeObjectURL(dataUrl);
        chrome.downloads.onChanged.removeListener(onChanged);

        if (delta.state?.current === 'interrupted') {
          reject(new Error('Download interrupted'));
          return;
        }

        resolve(downloadId);
      };
      chrome.downloads.onChanged.addListener(onChanged);
    });
  });
}

chrome.runtime.onMessage.addListener(function (rawRequest: unknown, _sender: chrome.runtime.MessageSender, sendResponse) {
  const request = rawRequest as BackgroundRequest;

  if (request.message === 'getColorScheme') {
    chrome.storage.local.set({ colorScheme: request.colorScheme });
  }

  if (request.message === 'backUpAllAsJSON') {
    debugLog('GPT-BACKUP::START::JSON');
    activeBackupController = createCancellationController();
    main(request.startOffset, request.stopOffset, activeBackupController, request.secondsBetweenChatDownloads)
      .then(async (result) => {
        const progressLabel = result.cancelled ? 'Building partial JSON file...' : 'Building JSON file...';
        setProgress(progressLabel, result.conversations.length + result.failures.length, result.cancelled ? 'cancelled' : 'running', result.requested);
        await downloadJson(result.conversations);
        const summary = result.cancelled
          ? `Stopped and downloaded ${result.conversations.length} chats${result.failures.length ? `, skipped ${result.failures.length}` : ''}`
          : result.failures.length
            ? `Downloaded ${result.conversations.length} chats, skipped ${result.failures.length}`
            : `Downloaded ${result.conversations.length} chats`;
        setProgress(summary, result.conversations.length + result.failures.length, result.cancelled || result.failures.length ? 'warning' : 'done', result.requested);
        activeBackupController = null;
        sendResponse({ message: result.cancelled ? 'backUpAllAsJSON partial' : 'backUpAllAsJSON done', ...result, cancelled: result.cancelled });
      })
      .catch((error) => {
        debugError('GPT-BACKUP::ERROR::JSON', error);
        const wasCancelled = String(getErrorMessage(error)) === 'Backup stopped by user';
        setProgress(wasCancelled ? 'Backup stopped' : `Backup failed: ${getErrorMessage(error)}`, 0, wasCancelled ? 'cancelled' : 'error');
        activeBackupController = null;
        sendResponse({ message: wasCancelled ? 'backUpAllAsJSON stopped' : 'backUpAllAsJSON failed', error: getErrorMessage(error), cancelled: wasCancelled });
      });
  }
  if (request.message === 'backUpAllAsRAWJSON') {
    debugLog('GPT-BACKUP::START::RAWJSON');
    activeBackupController = createCancellationController();
    mainRaw(request.startOffset, request.stopOffset, activeBackupController, request.secondsBetweenChatDownloads)
      .then(async (result) => {
        const progressLabel = result.cancelled ? 'Building partial raw JSON file...' : 'Building raw JSON file...';
        setProgress(progressLabel, result.rawConversations.length + result.failures.length, result.cancelled ? 'cancelled' : 'running', result.requested);
        await downloadRawJson(result.rawConversations);
        const summary = result.cancelled
          ? `Stopped and downloaded ${result.rawConversations.length} chats${result.failures.length ? `, skipped ${result.failures.length}` : ''}`
          : result.failures.length
            ? `Downloaded ${result.rawConversations.length} chats, skipped ${result.failures.length}`
            : `Downloaded ${result.rawConversations.length} chats`;
        setProgress(summary, result.rawConversations.length + result.failures.length, result.cancelled || result.failures.length ? 'warning' : 'done', result.requested);
        activeBackupController = null;
        sendResponse({ message: result.cancelled ? 'backUpAllAsRAWJSON partial' : 'backUpAllAsRAWJSON done', ...result, cancelled: result.cancelled });
      })
      .catch((error) => {
        debugError('GPT-BACKUP::ERROR::RAWJSON', error);
        const wasCancelled = String(getErrorMessage(error)) === 'Backup stopped by user';
        setProgress(wasCancelled ? 'Backup stopped' : `Backup failed: ${getErrorMessage(error)}`, 0, wasCancelled ? 'cancelled' : 'error');
        activeBackupController = null;
        sendResponse({ message: wasCancelled ? 'backUpAllAsRAWJSON stopped' : 'backUpAllAsRAWJSON failed', error: getErrorMessage(error), cancelled: wasCancelled });
      });
  }
  if (request.message === 'backUpAllAsMARKDOWN') {
    debugLog('GPT-BACKUP::START::MARKDOWN', request);
    activeBackupController = createCancellationController();
    const folderName = createMarkdownFolderName();
    const seenNames = new Set<string>();
    let advancedStartOffset = request.startOffset;
    let advancedStopOffset = request.stopOffset;
    let savedMarkdownCount = 0;
    let latestRequested = 0;
    sendResponse({ message: 'backUpAllAsMARKDOWN started' });
    void setMarkdownBackupRecovery({
      status: 'running',
      folderName,
      savedCount: 0,
      requested: 0,
      nextStartOffset: advancedStartOffset,
      nextStopOffset: advancedStopOffset,
    });

    void (async () => {
      setProgress('Choose a download folder...', 0, 'running');
      await createMarkdownDownloadFolder(folderName);
      setProgress('Download folder ready. Fetching chats...', 0, 'running');

      return main(
        request.startOffset,
        request.stopOffset,
        activeBackupController,
        request.secondsBetweenChatDownloads,
        async (conversation, completed, requested) => {
          latestRequested = requested;
          setProgress(`Saving markdown ${completed}/${requested}...`, completed, 'running', requested);
          await downloadMarkdownChatToFolder(
            conversation,
            folderName,
            seenNames,
            request.userLabel,
            request.assistantLabel,
            request.markdownExtension,
            request.mdxFrontmatter,
          );
          if (request.autoAdvanceStartOffset) {
            advancedStartOffset = request.startOffset + completed;
            advancedStopOffset = request.stopOffset === -1 ? -1 : request.stopOffset + completed;
            await setSyncStorage({ startOffset: advancedStartOffset, stopOffset: advancedStopOffset });
          }
          savedMarkdownCount = completed;
          await setMarkdownBackupRecovery({
            status: 'running',
            folderName,
            savedCount: savedMarkdownCount,
            requested,
            nextStartOffset: advancedStartOffset,
            nextStopOffset: advancedStopOffset,
          });
        },
      );
    })()
      .then((result) => {
        const summary = result.cancelled
          ? `Stopped and downloaded ${result.conversations.length} chats${result.failures.length ? `, skipped ${result.failures.length}` : ''}`
          : result.failures.length
            ? `Downloaded ${result.conversations.length} chats, skipped ${result.failures.length}`
            : `Downloaded ${result.conversations.length} chats`;
        setProgress(summary, result.conversations.length + result.failures.length, result.cancelled || result.failures.length ? 'warning' : 'done', result.requested);
        void setMarkdownBackupRecovery({
          status: result.cancelled ? 'cancelled' : result.failures.length ? 'warning' : 'done',
          folderName,
          savedCount: savedMarkdownCount,
          requested: result.requested,
          nextStartOffset: advancedStartOffset,
          nextStopOffset: advancedStopOffset,
        });
        activeBackupController = null;
      })
      .catch((error) => {
        debugError('GPT-BACKUP::ERROR::MARKDOWN', error);
        const wasCancelled = String(getErrorMessage(error)) === 'Backup stopped by user';
        const resumeText = request.autoAdvanceStartOffset
          ? 'Run All Chats Markdown again to resume from Skip newest chats.'
          : 'Auto-advance is off, so increase Skip newest chats manually before retrying.';
        const failureMessage = wasCancelled
          ? `Backup stopped. Saved ${savedMarkdownCount} chat(s). ${resumeText}`
          : `Backup failed after saving ${savedMarkdownCount} chat(s): ${getErrorMessage(error)}. ${resumeText}`;
        setProgress(failureMessage, savedMarkdownCount, wasCancelled ? 'cancelled' : 'error', latestRequested || undefined);
        void setMarkdownBackupRecovery({
          status: wasCancelled ? 'cancelled' : 'error',
          folderName,
          savedCount: savedMarkdownCount,
          requested: latestRequested,
          nextStartOffset: advancedStartOffset,
          nextStopOffset: advancedStopOffset,
          error: getErrorMessage(error),
        });
        activeBackupController = null;
      });
    return false;
  }

  if (request.message === 'stopBackup') {
    if (activeBackupController) {
      debugLog('GPT-BACKUP::STOP::requested');
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
        const projectInfo = parseProjectInfoFromUrl(activeTab.url || '');
        if (!projectInfo.isProjectChat || !projectInfo.normalizedProjectIdFromSlug) {
          sendResponse({ message: 'backUpCurrentProject failed', error: 'Current tab is not a project chat.' });
          return;
        }

        const { token, id } = await getConversationIdFromTabs(tabs);
        const referenceConversation = await fetchConversation(token, id);
        debugLog(`GPT-BACKUP::PROJECT::reference-conversation::${JSON.stringify({
          projectInfo,
          title: referenceConversation?.title,
          conversation_id: referenceConversation?.conversation_id,
          identifiers: extractProjectIdentifiers(referenceConversation),
        })}`);

        if (!activeTab.id || !projectInfo.projectSlug) {
          sendResponse({ message: 'backUpCurrentProject failed', error: 'Missing active ChatGPT project tab.' });
          return;
        }

        const conversationIdsFromDom = await getProjectConversationIdsFromTab(activeTab.id, projectInfo.projectSlug);
        const orderedConversationIds = Array.from(new Set([id, ...conversationIdsFromDom]));
        debugLog(`GPT-BACKUP::PROJECT::conversation-ids-from-dom::${JSON.stringify({
          projectSlug: projectInfo.projectSlug,
          conversationIdsFromDom,
          orderedConversationIds,
        })}`);

        activeBackupController = createCancellationController();
        const result = await fetchRawConversationsByIds(token, orderedConversationIds, activeBackupController, getChatDownloadDelayMs(request.secondsBetweenChatDownloads));
        const filteredRawConversations = filterRawConversationsByProject(result.rawConversations, projectInfo, referenceConversation);
        const fallbackRawConversations = filteredRawConversations.length ? filteredRawConversations : result.rawConversations;
        debugLog(`GPT-BACKUP::PROJECT::dom-fetch-result::${JSON.stringify({
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
          setProgress('Building project raw JSON file...', fallbackRawConversations.length, result.cancelled ? 'cancelled' : 'running', orderedConversationIds.length);
          await downloadRawJson(fallbackRawConversations);
          sendResponse({ message: 'backUpCurrentProject done', rawConversations: fallbackRawConversations, failures: result.failures, cancelled: result.cancelled, projectInfo });
        } else if (request.downloadType === 'json') {
          setProgress('Building project JSON file...', filteredConversations.length, result.cancelled ? 'cancelled' : 'running', orderedConversationIds.length);
          await downloadJson(filteredConversations);
          sendResponse({ message: 'backUpCurrentProject done', conversations: filteredConversations, failures: result.failures, cancelled: result.cancelled, projectInfo });
        } else {
          setProgress('Building project markdown zip...', filteredConversations.length, result.cancelled ? 'cancelled' : 'running', orderedConversationIds.length);
          await downloadMarkdownZip(filteredConversations, request.userLabel || 'USER', request.assistantLabel || 'ASSISTANT', request.markdownExtension || '.md', request.mdxFrontmatter || '---\ntitle: "{{title}}"\n---');
          sendResponse({ message: 'backUpCurrentProject done', conversations: filteredConversations, failures: result.failures, cancelled: result.cancelled, projectInfo });
        }

        setProgress(summary, fallbackRawConversations.length + result.failures.length, result.cancelled || result.failures.length ? 'warning' : 'done', orderedConversationIds.length);
        activeBackupController = null;
      } catch (error) {
        debugError('GPT-BACKUP::ERROR::PROJECT', error);
        activeBackupController = null;
        setProgress(`Backup failed: ${getErrorMessage(error)}`, 0, 'error');
        sendResponse({ message: 'backUpCurrentProject failed', error: getErrorMessage(error) });
      }
    });
  }

  if (request.message === 'backUpSingleChat') {
    const action = request.downloadType === 'raw-json'
      ? handleSingleRawUrlId(request.tabs).then(async (rawConversation) => {
          const parsedRawConversation = normalizeRawConversations(Array.isArray(rawConversation) ? rawConversation : [rawConversation]);
          const shouldBundleImages = Boolean(request.includeImages) && parsedRawConversation.some((chat) => Boolean(chat.images?.length));
          if (shouldBundleImages) {
            await downloadRawJsonZipWithImages(rawConversation);
          } else {
            await downloadRawJson(rawConversation);
          }
          setProgress('Download complete', rawConversation.length, 'done', rawConversation.length);
          sendResponse({ message: 'backUpSingleChat done', rawConversation });
        })
      : handleSingleUrlId(request.tabs).then(async (conversation) => {
          if (request.downloadType === 'json') {
            const shouldBundleImages = Boolean(request.includeImages) && conversation.some((chat) => Boolean(chat.images?.length));
            if (shouldBundleImages) {
              await downloadJsonZipWithImages(conversation);
            } else {
              await downloadJson(conversation);
            }
          } else {
            await downloadMarkdownZip(conversation, request.userLabel || 'USER', request.assistantLabel || 'ASSISTANT', request.markdownExtension || '.md', request.mdxFrontmatter || '---\ntitle: "{{title}}"\n---', Boolean(request.includeImages));
          }
          setProgress('Download complete', conversation.length, 'done', conversation.length);
          sendResponse({ message: 'backUpSingleChat done', conversation });
        });

    action.catch((error) => {
      debugError(error);
      setProgress(`Backup failed: ${getErrorMessage(error)}`, 0, 'error');
      sendResponse({ message: 'backUpSingleChat failed', error: getErrorMessage(error) });
    });
  }
  return true;
});

function parseProjectInfoFromUrl(url: string): ProjectInfo {
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

async function getConversationIdFromTabs(tabs: chrome.tabs.Tab[]): Promise<{ token: string; id: string; projectInfo: ProjectInfo }> {
  const url = tabs[0]?.url || '';
  const projectInfo = parseProjectInfoFromUrl(url);
  const conversationId = projectInfo.conversationId;
  const regex = /[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/g;
  const token = await loadToken();

  debugLog(`GPT-BACKUP::URL::project-info::${JSON.stringify(projectInfo)}`);

  if (!conversationId || !conversationId.match(regex)) {
    const res = await getConversationIds(token);
    return { token, id: res.items[0].id, projectInfo };
  }

  return { token, id: conversationId, projectInfo };
}

async function ensureProjectContentScript(tabId: number) {
  try {
    return await new Promise<AnyRecord | undefined>((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { message: 'getCurrentProjectConversationIds', projectSlug: '__ping__' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    });
  } catch (error) {
    debugLog(`GPT-BACKUP::PROJECT::content-script-missing::${JSON.stringify({ tabId, error: getErrorMessage(error) })}`);
    throw new Error('Update required: This ChatGPT tab was opened before the extension update, so project backup cannot reach the page yet. Reload or hard-refresh the ChatGPT tab, then retry the project backup.');
  }
}

async function getProjectConversationIdsFromTab(tabId: number, projectSlug: string): Promise<string[]> {
  await ensureProjectContentScript(tabId);

  return new Promise<string[]>((resolve, reject) => {
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

async function fetchRawConversationsByIds(token: string, conversationIds: string[], controller: CancellationController, chatDownloadDelayMs = getChatDownloadDelayMs()) {
  const rawConversations: ChatGptRawConversation[] = [];
  const failures: BackupFailure[] = [];
  let cancelled = false;

  setProgress('Fetching project chats...', 0, 'running', conversationIds.length);

  for (const id of conversationIds) {
    if (isCancelled(controller)) {
      cancelled = true;
      break;
    }

    await sleep(chatDownloadDelayMs);
    if (isCancelled(controller)) {
      cancelled = true;
      break;
    }

    try {
      const rawConversation = await fetchConversation(token, id);
      rawConversations.push(rawConversation);
      const title = rawConversation?.title || 'untitled';
      const shortTitle = title.length > 20 ? `${title.substring(0, 20)}...` : title;
      setProgress(shortTitle, rawConversations.length, 'running', conversationIds.length);
    } catch (error) {
      failures.push({ id, error: getErrorMessage(error) });
      setProgress(`Skipped ${failures.length} project chat(s)`, rawConversations.length + failures.length, 'warning', conversationIds.length);
    }
  }

  return { rawConversations, failures, cancelled };
}

async function handleSingleUrlId(tabs: chrome.tabs.Tab[]): Promise<ParsedConversation[]> {
  const { token, id } = await getConversationIdFromTabs(tabs);
  const rawConversation = await fetchConversation(token, id);
  const conversation = parseConversation(rawConversation);
  return [conversation];
}

async function handleSingleRawUrlId(tabs: chrome.tabs.Tab[]): Promise<ChatGptRawConversation[]> {
  const { token, id, projectInfo } = await getConversationIdFromTabs(tabs);
  const rawConversation = await fetchConversation(token, id);
  debugLog(`GPT-BACKUP::RAW::single-chat-project-context::${JSON.stringify({
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

  debugLog(`GPT-BACKUP::RAW::single-chat-project-summary::${JSON.stringify({
    title: rawConversation?.title,
    projectSlug: projectInfo?.projectSlug,
    normalizedProjectIdFromSlug: projectInfo?.projectSlug?.match(/(g-p-[a-z0-9]+)/)?.[1] || null,
    gizmo_id: rawConversation?.gizmo_id,
    conversation_template_id: rawConversation?.conversation_template_id,
    sameProjectId: (projectInfo?.projectSlug?.match(/(g-p-[a-z0-9]+)/)?.[1] || null) === rawConversation?.gizmo_id,
  })}`);
  return [rawConversation];
}

function collectStringValuesByKey(value: unknown, keyNames: ReadonlySet<string>, results = new Set<string>(), seen = new WeakSet<object>()): Set<string> {
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

function extractProjectIdentifiers(rawConversation: ChatGptRawConversation): string[] {
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

function applyMdxFrontmatter(markdown: string, title: string, markdownExtension: MarkdownExtension = '.md', mdxFrontmatter = '---\ntitle: "{{title}}"\n---'): string {
  if (markdownExtension !== '.mdx') {
    return markdown;
  }

  const frontmatter = String(mdxFrontmatter || '').replaceAll('{{title}}', String(title || 'untitled'));
  const normalizedFrontmatter = frontmatter.trim() ? `${frontmatter.trim()}\n\n` : '';
  return `${normalizedFrontmatter}${markdown}`;
}

function filterRawConversationsByProject(rawConversations: ChatGptRawConversation[], projectInfo: ProjectInfo, referenceConversation: ChatGptRawConversation | null = null): ChatGptRawConversation[] {
  const projectCandidates = new Set([
    projectInfo?.normalizedProjectIdFromSlug,
    projectInfo?.projectSlug,
    ...(referenceConversation ? extractProjectIdentifiers(referenceConversation) : []),
  ].filter(Boolean));

  debugLog(`GPT-BACKUP::PROJECT::filter-candidates::${JSON.stringify(Array.from(projectCandidates))}`);

  const filtered = rawConversations.filter((conversation) => {
    const identifiers = extractProjectIdentifiers(conversation);
    return identifiers.some((identifier) => projectCandidates.has(identifier));
  });

  debugLog(`GPT-BACKUP::PROJECT::filter-result::${JSON.stringify({
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

function normalizeRawConversations(rawConversations: ChatGptRawConversation[]): ParsedConversation[] {
  return rawConversations.map((rawConversation) => parseConversation(rawConversation));
}

function slugifyImageFilenameBase(name: string): string {
  return sanitizeFilename(name)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'image';
}

function getImageAltText(image: ImageAssetReference): string {
  return image.name || image.fileId;
}

function getImageFilename(image: ImageAssetReference): string {
  return `${slugifyImageFilenameBase(image.name || image.fileId)}.png`;
}

async function getImageDownloadUrl(fileId: string, conversationId: string): Promise<string> {
  const token = await loadToken();
  const url =
    `https://chatgpt.com/backend-api/files/download/${fileId}` +
    `?conversation_id=${encodeURIComponent(conversationId)}` +
    '&inline=false' +
    '&download_intent=false';

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) clearTokenCache();
    throw new Error(`failed to get image download URL (${response.status})`);
  }

  const data = await response.json() as { status?: string; download_url?: string };
  if (data.status !== 'success' || !data.download_url) {
    throw new Error(`Failed to get download URL for ${fileId}`);
  }

  return data.download_url;
}

async function downloadImageBlob(fileId: string, conversationId: string): Promise<Blob> {
  const token = await loadToken();
  const downloadUrl = await getImageDownloadUrl(fileId, conversationId);
  const response = await fetch(downloadUrl, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) clearTokenCache();
    throw new Error(`Image download failed for ${fileId}: ${response.status}`);
  }

  return response.blob();
}

function getImageFileIdFilename(image: ImageAssetReference): string {
  return `${sanitizeFilename(image.fileId)}.png`;
}

async function addChatImagesToZip(
  zipWriter: ZipWriter<Blob>,
  chat: ParsedConversation,
  getFilename: (image: ImageAssetReference) => string = getImageFilename,
): Promise<void> {
  if (!chat.conversation_id || !chat.images?.length) return;

  for (const image of chat.images) {
    const blob = await downloadImageBlob(image.fileId, chat.conversation_id);
    await zipWriter.add(`images/${getFilename(image)}`, new BlobReader(blob));
  }
}

async function downloadMarkdownZip(
  chats: ParsedConversation[],
  userLabel: string,
  assistantLabel: string,
  markdownExtension: MarkdownExtension = '.md',
  mdxFrontmatter = '---\ntitle: "{{title}}"\n---',
  includeImages = false,
  fileBaseName = 'gpt-backup',
) {
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const onlyOneChat = chats.length === 1;
  const enrichedChats = enrichChatsForJson(chats);
  const shouldBundleImages = includeImages && onlyOneChat && Boolean(enrichedChats[0]?.images?.length);

  if (onlyOneChat && !shouldBundleImages) {
    const title = sanitizeFilename(enrichedChats[0].title || 'untitled');
    const markdown = applyMdxFrontmatter(
      jsonToMarkdown(enrichedChats[0], userLabel, assistantLabel, includeImages),
      enrichedChats[0].title || 'untitled',
      markdownExtension,
      mdxFrontmatter,
    );
    return saveAs(markdown, 'text/markdown', `${title}${markdownExtension}`);
  }

  const zipFileWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(zipFileWriter);
  const seenNames = new Set<string>();

  try {
    for (const chat of enrichedChats) {
      const title = sanitizeFilename(chat.title || 'untitled');
      const filename = dedupeFilename(title, seenNames);
      const markdown = applyMdxFrontmatter(
        jsonToMarkdown(chat, userLabel, assistantLabel, shouldBundleImages),
        chat.title || 'untitled',
        markdownExtension,
        mdxFrontmatter,
      );
      await zipWriter.add(`${filename}${markdownExtension}`, new TextReader(markdown));
      if (shouldBundleImages) {
        await addChatImagesToZip(zipWriter, chat);
      }
    }

    const content = await zipWriter.close();
    return saveAs(content, 'application/zip', `${fileBaseName}-${dateStr}.zip`);
  } catch (error) {
    await zipWriter.close().catch(() => {});
    throw error;
  }
}

function createMarkdownFolderName(prefix = 'gpt-backup') {
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${dateStr}`;
}

async function createMarkdownDownloadFolder(folderName: string) {
  const content = [
    'ChatGPT Backup markdown export started.',
    '',
    'Markdown files will be downloaded into this folder one by one.',
    'If the export stops unexpectedly, run All Chats Markdown again to resume from the updated Skip newest chats value.',
    '',
    `Started at: ${new Date().toISOString()}`,
  ].join('\n');

  return saveAs(content, 'text/plain', `${folderName}/_download-started.txt`, false);
}

async function downloadMarkdownChatToFolder(
  chat: ParsedConversation,
  folderName: string,
  seenNames: Set<string>,
  userLabel: string,
  assistantLabel: string,
  markdownExtension: MarkdownExtension = '.md',
  mdxFrontmatter = '---\ntitle: "{{title}}"\n---',
) {
  const enrichedChat = enrichChatsForJson([chat])[0];
  const title = sanitizeFilename(enrichedChat.title || 'untitled');
  const filename = dedupeFilename(title, seenNames);
  const markdown = applyMdxFrontmatter(
    jsonToMarkdown(enrichedChat, userLabel, assistantLabel, false),
    enrichedChat.title || 'untitled',
    markdownExtension,
    mdxFrontmatter,
  );

  return saveAs(markdown, 'text/markdown', `${folderName}/${filename}${markdownExtension}`, false);
}

function jsonToMarkdown(
  json: ParsedConversation,
  userLabel = 'USER',
  assistantLabel = 'ASSISTANT',
  includeImages = false,
): string {
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
    const imageMarkdown = includeImages && message.images?.length
      ? message.images.map((image) => `![${getImageAltText(image)}](images/${getImageFilename(image)})`).join('\n\n')
      : '';

    if (!label && !body.trim() && !imageMarkdown.trim()) {
      continue;
    }

    const sections: string[] = [];
    if (label) sections.push(label);
    if (body.trim()) sections.push(body);
    if (imageMarkdown.trim()) sections.push(imageMarkdown);

    output += `${sections.join('\n\n')}\n\n---\n\n`;
  }

  return output;
}
async function downloadJson(data: ParsedConversation[]) {
  debugLog(data);
  if (!data) {
    throw new Error('No data');
  }
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const enrichedData = enrichChatsForJson(data);
  const jsonString = JSON.stringify(enrichedData, null, 2);
  return saveAs(jsonString, 'application/json', `gpt-backup-${dateStr}.json`);
}

async function downloadJsonZipWithImages(data: ParsedConversation[]) {
  debugLog(data);
  if (!data) {
    throw new Error('No data');
  }

  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const enrichedData = enrichChatsForJson(data);
  const zipFileWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(zipFileWriter);

  try {
    await zipWriter.add(`gpt-backup-${dateStr}.json`, new TextReader(JSON.stringify(enrichedData, null, 2)));
    for (const chat of enrichedData) {
      await addChatImagesToZip(zipWriter, chat, getImageFileIdFilename);
    }

    const content = await zipWriter.close();
    return saveAs(content, 'application/zip', `gpt-backup-${dateStr}.zip`);
  } catch (error) {
    await zipWriter.close().catch(() => {});
    throw error;
  }
}

async function downloadRawJson(data: ChatGptRawConversation | ChatGptRawConversation[]) {
  debugLog(data);
  if (!data) {
    throw new Error('No raw data');
  }
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonString = JSON.stringify(data, null, 2);
  return saveAs(jsonString, 'application/json', `gpt-backup-raw-${dateStr}.json`);
}

async function downloadRawJsonZipWithImages(data: ChatGptRawConversation | ChatGptRawConversation[]) {
  debugLog(data);
  if (!data) {
    throw new Error('No raw data');
  }

  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const rawConversations = Array.isArray(data) ? data : [data];
  const parsedConversations = normalizeRawConversations(rawConversations);
  const zipFileWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(zipFileWriter);

  try {
    await zipWriter.add(`gpt-backup-raw-${dateStr}.json`, new TextReader(JSON.stringify(data, null, 2)));
    for (const chat of parsedConversations) {
      await addChatImagesToZip(zipWriter, chat, getImageFileIdFilename);
    }

    const content = await zipWriter.close();
    return saveAs(content, 'application/zip', `gpt-backup-raw-${dateStr}.zip`);
  } catch (error) {
    await zipWriter.close().catch(() => {});
    throw error;
  }
}

});
