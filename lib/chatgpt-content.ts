import { marked } from 'marked';

type RecordData = Record<string, any>;

/** Extract readable voice transcripts without interpreting JSON-looking message text.
 * Other structured parts retain the existing JSON fallback for lossless inspection. */
export function contentPartToText(part: unknown): string {
  if (typeof part === 'string') return part;
  if (part && typeof part === 'object' && 'content_type' in part && part.content_type === 'audio_transcription' && 'text' in part && typeof part.text === 'string') {
    return part.text;
  }
  return JSON.stringify(part) ?? '';
}

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*{}\[\]()#+.!_|~-]/g, '\\$&');

function link(title: string, url: string): string {
  // Only external web sources are valid citation destinations.
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return escapeText(title);
    return `[${escapeText(title)}](<${parsed.href.replace(/>/g, '%3E')}>)`;
  } catch { return escapeText(title); }
}

// Recover only a fully validated literal feature/priority array. No JavaScript,
// expressions, state initializers or event handlers are ever evaluated.
function priorityTable(raw: string): string | undefined {
  const match = /\{@body const features = (\[[\s\S]*?\])\}/.exec(raw);
  if (!match || !raw.includes('{#each features as f,i}')) return;
  const string = '"(?:[^"\\\\]|\\\\.)*"';
  const item = `\\{name:${string},priority:${string}\\}`;
  if (!new RegExp(`^\\[${item}(?:,${item})*\\]$`).test(match[1])) return;
  try {
    const rowPattern = new RegExp(`\\{name:(${string}),priority:(${string})\\}`, 'g');
    const rows = Array.from(match[1].matchAll(rowPattern), row => ({
      name: JSON.parse(row[1]) as string,
      priority: JSON.parse(row[2]) as string,
    }));
    return '| Feature | Priority |\n| --- | --- |\n' + rows.map(row => `| ${escapeText(row.name)} | ${escapeText(row.priority)} |`).join('\n');
  } catch { return; }
}

/** Remove serialization noise without decoding HTML or changing Markdown syntax. */
export function cleanMarkdownSource(source: string): string {
  const protectedParts: string[] = [];
  const save = (raw: string) => `\u0000GPT_LITERAL_${protectedParts.push(raw) - 1}\u0000`;
  let text = source;
  // Keep examples, HTML, and link/image destinations byte-for-byte intact.
  const literals: string[] = [];
  marked.walkTokens(marked.lexer(source), token => {
    if (['code', 'codespan', 'html', 'link', 'image'].includes(token.type)) literals.push(token.raw);
  });
  for (const literal of literals) text = text.replace(literal, () => save(literal));
  // Protect escaped backslashes and entities: never decode a deliberate literal.
  text = text.replace(/\\\\|\\&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, save);
  text = text.replace(/&(?:#0*32|#[xX]0*20);/g, (entity, offset: number) => {
    const line = text.slice(text.lastIndexOf('\n', offset) + 1, offset);
    // Decoding must not introduce headings, lists, or blockquotes.
    return /^(?:[ \t]*>[ \t]*)*[ \t]*(?:#{1,6}|[-+*>]|\d+[.)])$/.test(line) ? entity : ' ';
  });
  text = text.replace(/\\([!:.])/g, (escape, punctuation: string, offset: number) => {
    if (punctuation === '!' && ['[', '\u0000'].includes(text[offset + escape.length])) return escape;
    // An escaped period may be preventing an ordered list, including in quotes.
    const line = text.slice(text.lastIndexOf('\n', offset) + 1, offset);
    if (punctuation === '.' && /^(?:[ \t]*>[ \t]*)*[ \t]*\d+$/.test(line)) return escape;
    return punctuation;
  });
  // Markdown hard breaks use two spaces; empty break-only lines become paragraphs.
  text = text.replace(/^[ \t]*\\\r?$/gm, '');
  text = text.replace(/(?<!\\)\\\r?\n/g, '  \n');
  return text.replace(/\u0000GPT_LITERAL_(\d+)\u0000/g, (_all, index: string) => protectedParts[Number(index)]);
}

/** Convert ChatGPT's saved UI fallback and source references into static Markdown.
 * Raw messages and metadata are never changed. */
export function normalizeChatGPTContent(raw: string, metadata: RecordData = {}): string {
  const fallback = metadata.model_dil_v2?.fallbackMarkdown;
  const usesFallback = typeof fallback === 'string' && fallback.trim().length > 0;
  let text = cleanMarkdownSource(usesFallback ? fallback : raw);
  if (usesFallback && /\{@body|<(?:box|grid|row|checkbox)\b/.test(raw)) {
    const table = priorityTable(raw);
    const placeholder = '**Development priorities**  selected\n\n[Copy selected priorities]';
    if (table && text.includes(placeholder)) {
      text = text.replace(placeholder, '**Development priorities**\n\n' + table);
    } else {
      text += '\n\n> Export note: Interactive layout shown as static text; dynamic content may be unavailable.';
    }
  }

  const sources = new Map<string, { title: string; url: string }>();
  const groups = metadata.search_result_groups;
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const entry of Array.isArray(group?.entries) ? group.entries : []) {
      const ref = entry?.ref_id;
      const id = typeof ref === 'string' ? ref : ref && `turn${ref.turn_index}${ref.ref_type}${ref.ref_index}`;
      if (id && typeof entry.url === 'string') sources.set(id, { title: entry.title || entry.url, url: entry.url });
    }
  }
  const citation = (ids: string[]) => ids.map(id => {
    const source = sources.get(id);
    return source ? link(source.title, source.url) : `[Source unavailable: ${escapeText(id)}]`;
  }).join('; ');

  // Protect real code examples before interpreting ChatGPT-specific markers.
  const protectedCode: string[] = [];
  marked.walkTokens(marked.lexer(text), token => {
    if (token.type === 'code' || token.type === 'codespan') protectedCode.push(token.raw);
  });
  const saved: string[] = [];
  for (const code of protectedCode) {
    text = text.replace(code, () => `\u0000GPT_CODE_${saved.push(code) - 1}\u0000`);
  }
  text = text.replace(/url([^]*?)([^]*?)/g, (_all: string, title: string, url: string) => link(title, url));
  text = text.replace(/cite([^]*)/g, (_all: string, ids: string) => citation(ids.split('')));
  text = text.replace(/<Cite\s+refs=\{(\[[\s\S]*?\])\}\s*\/>/g, (all: string, json: string) => {
    try {
      const ids: unknown = JSON.parse(json);
      return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? citation(ids) : all;
    } catch { return all; }
  });
  return text.replace(/\u0000GPT_CODE_(\d+)\u0000/g, (_all: string, index: string) => saved[Number(index)]);
}
