import { normalizeChatGPTContent } from './chatgpt-content.ts';
type AnyRecord = Record<string, unknown>;
export type MarkdownExtension = '.md' | '.mdx';
const debugWarn = (..._args: unknown[]) => {};
export type MarkdownSettings = {
  userLabel: string;
  assistantLabel: string;
  markdownExtension: MarkdownExtension;
  mdxFrontmatter: string;
};

export type ImageAssetReference = {
  fileId: string;
  assetPointer: string;
  name?: string;
};

export type AttachmentReference = {
  fileId: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type UnsupportedAssetReference = {
  assetPointer: string;
  category: 'document-page-preview' | 'unknown';
  reason: string;
};

export type AssetPointerParseResult =
  | { category: 'downloadable-image'; image: ImageAssetReference }
  | { category: 'document-page-preview' | 'unknown'; unsupported: UnsupportedAssetReference };

export type NormalizedMessage = {
  role: 'user' | 'assistant';
  content: string[];
  model: string | null;
  create_time?: number;
  metadata: AnyRecord;
  contentType: string | null;
  images?: ImageAssetReference[];
  attachments?: AttachmentReference[];
  unsupported_assets?: UnsupportedAssetReference[];
  rendered_markdown?: string;
  rendered_text?: string;
};

export type ParsedConversation = {
  messages: NormalizedMessage[];
  create_time?: number;
  title?: string;
  conversation_id?: string;
  images?: ImageAssetReference[];
  attachments?: AttachmentReference[];
  unsupported_assets?: UnsupportedAssetReference[];
};

function sanitizeFilename(name = 'untitled'): string {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
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
  let rendered = normalizeChatGPTContent(String(text || ''), metadata);
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


export function applyMdxFrontmatter(markdown: string, title: string, markdownExtension: MarkdownExtension = '.md', mdxFrontmatter = '---\ntitle: "{{title}}"\n---'): string {
  if (markdownExtension !== '.mdx') {
    return markdown;
  }

  const frontmatter = String(mdxFrontmatter || '').replaceAll('{{title}}', String(title || 'untitled'));
  const normalizedFrontmatter = frontmatter.trim() ? `${frontmatter.trim()}\n\n` : '';
  return `${normalizedFrontmatter}${markdown}`;
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


function getAttachmentFilename(attachment: AttachmentReference): string {
  return sanitizeFilename(attachment.name || attachment.fileId);
}


export function markdownTitle(title?: string): string {
  const text = (title ?? '').replace(/[\r\n]+/g, ' ').trim();
  return text ? `# ${text.replace(/([\\`*_{}\[\]<>#!|])/g, '\\$1')}\n\n` : '';
}

export function jsonToMarkdown(
  json: ParsedConversation,
  userLabel = 'USER',
  assistantLabel = 'ASSISTANT',
  includeImages = false,
  showTitle = false,
): string {
  let output = showTitle ? markdownTitle(json.title) : '';

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
      ? message.images.map((image) => `![${getImageAltText(image)}](images/${encodeURI(getImageFilename(image))})`).join('\n\n')
      : '';
    const attachmentMarkdown = includeImages && message.attachments?.length
      ? message.attachments.map((attachment) => `[Attachment: ${attachment.name}](attachments/${encodeURI(getAttachmentFilename(attachment))})`).join('\n\n')
      : '';

    if (!label && !body.trim() && !imageMarkdown.trim() && !attachmentMarkdown.trim()) {
      continue;
    }

    const sections: string[] = [];
    if (label) sections.push(label);
    if (body.trim()) sections.push(body);
    if (imageMarkdown.trim()) sections.push(imageMarkdown);
    if (attachmentMarkdown.trim()) sections.push(attachmentMarkdown);

    output += `${sections.join('\n\n')}\n\n---\n\n`;
  }

  return output;
}

export function selectMarkdownMessages(chat: ParsedConversation, ids: Iterable<number>): ParsedConversation {
  const selected = new Set(ids);
  const messages = chat.messages.filter((_, i) => selected.has(i));
  const unique = <T,>(items: T[], key: (item: T) => string) => [...new Map(items.map(item => [key(item), item])).values()];
  return { ...chat, messages,
    images: unique(messages.flatMap(m => m.images || []), a => a.fileId),
    attachments: unique(messages.flatMap(m => m.attachments || []), a => a.fileId),
    unsupported_assets: unique(messages.flatMap(m => m.unsupported_assets || []), a => a.assetPointer),
  };
}
export function validateMarkdownDownload(value: unknown): asserts value is { chat: ParsedConversation; options: MarkdownSettings & { includeImages: boolean; showTitle?: boolean } } {
  const v = value as any;
  const id = (s: unknown) => typeof s === 'string' && /^[a-zA-Z0-9_-]+$/.test(s);
  const text = (s: unknown) => typeof s === 'string';
  const arrays = (m: any) => (m.images === undefined || (Array.isArray(m.images) && m.images.every((a: any) => a && id(a.fileId) && text(a.assetPointer) && (a.name === undefined || text(a.name)))))
    && (m.attachments === undefined || (Array.isArray(m.attachments) && m.attachments.every((a: any) => a && id(a.fileId) && text(a.name) && (a.mimeType === undefined || text(a.mimeType)) && (a.sizeBytes === undefined || (Number.isFinite(a.sizeBytes) && a.sizeBytes >= 0)))) )
    && (m.unsupported_assets === undefined || (Array.isArray(m.unsupported_assets) && m.unsupported_assets.every((a: any) => a && text(a.assetPointer) && text(a.reason) && ['unknown', 'document-page-preview'].includes(a.category))));
  if (!v?.chat || !id(v.chat.conversation_id) || (v.chat.title !== undefined && !text(v.chat.title)) || !Array.isArray(v.chat.messages) || !v.chat.messages.length || !arrays(v.chat)
    || !v.chat.messages.every((m: any) => m && ['user', 'assistant'].includes(m.role) && Array.isArray(m.content) && m.content.every(text) && m.metadata && typeof m.metadata === 'object' && !Array.isArray(m.metadata) && (m.rendered_markdown === undefined || text(m.rendered_markdown)) && arrays(m))
    || !v.options || !text(v.options.userLabel) || !text(v.options.assistantLabel) || !text(v.options.mdxFrontmatter) || !['.md', '.mdx'].includes(v.options.markdownExtension) || typeof v.options.includeImages !== 'boolean' || (v.options.showTitle !== undefined && typeof v.options.showTitle !== 'boolean')) throw new Error('Invalid Markdown export payload.');
}
