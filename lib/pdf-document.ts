import { marked, type Token } from 'marked';
import type { Content, ContentText, TDocumentDefinitions } from 'pdfmake/interfaces';

import { messageLabel, safeExportLink, type ExportConversation, type ExportLabels } from './export-document.ts';
export type PdfChat = ExportConversation;
export type PdfLabels = ExportLabels;

function inline(tokens: Token[]): ContentText[] {
  return tokens.flatMap((token): ContentText[] => {
    switch (token.type) {
      case 'strong': return inline(token.tokens || []).map(t => ({ ...t, bold: true }));
      case 'em': return inline(token.tokens || []).map(t => ({ ...t, italics: true }));
      case 'del': return inline(token.tokens || []).map(t => ({ ...t, decoration: 'lineThrough' }));
      case 'link': return inline(token.tokens || []).map(t => ({ ...t, link: safeExportLink(token.href), color: '#176650' }));
      case 'codespan': return [{ text: token.text, font: 'Mono', background: '#f1f3f5' }];
      case 'br': return [{ text: '\n' }];
      case 'image': return [{ text: token.text || token.href, link: safeExportLink(token.href), italics: true }];
      default: return 'tokens' in token && token.tokens ? inline(token.tokens) : [{ text: ('text' in token ? token.text : token.raw) || '' }];
    }
  });
}

export function markdownBlocks(markdown: string): Content[] {
  function blocks(tokens: Token[]): Content[] {
    return tokens.flatMap((token): Content[] => {
      switch (token.type) {
        case 'space': return [];
        case 'heading': return [{ headlineLevel: token.depth, text: inline(token.tokens || []), fontSize: Math.max(12, 22 - token.depth * 2), bold: true, margin: [0, 10, 0, 5] }];
        case 'paragraph': case 'text': return [{ text: inline(token.tokens || [token]), margin: [0, 0, 0, 8] }];
        case 'code': return [{ text: token.text, font: 'Mono', fontSize: 9, preserveLeadingSpaces: true, background: '#f1f3f5', margin: [8, 5, 8, 10] }];
        case 'blockquote': return [{ stack: blocks(token.tokens || []), color: '#56616b', margin: [12, 4, 0, 8] }];
        case 'list': {
          const items = token.items.map((item: { tokens: Token[] }) => ({ stack: blocks(item.tokens) }));
          return [token.ordered ? { ol: items, start: Number(token.start) || 1, margin: [0, 0, 0, 8] } : { ul: items, margin: [0, 0, 0, 8] }];
        }
        case 'table': {
          // Very wide tables read better as a series of labeled rows on portrait paper.
          if (token.header.length > 5) return token.rows.map((row: { tokens: Token[] }[]) => ({
            stack: row.map((cell, i) => ({ text: [...inline(token.header[i].tokens).map(t => ({ ...t, bold: true })), { text: ': ' }, ...inline(cell.tokens)] })), margin: [0, 4, 0, 8],
          }));
          return [{ table: { headerRows: 1, widths: token.header.map(() => '*'), body: [
            token.header.map((cell: { tokens: Token[] }) => ({ text: inline(cell.tokens), bold: true, fillColor: '#edf3f0' })),
            ...token.rows.map((row: { tokens: Token[] }[]) => row.map(cell => ({ text: inline(cell.tokens) }))),
          ] }, layout: 'lightHorizontalLines', fontSize: 9, margin: [0, 4, 0, 12] }];
        }
        case 'hr': return [{ text: ' ', margin: [0, 4, 0, 4] }];
        default: return [{ text: token.raw || '', margin: [0, 0, 0, 8] }];
      }
    });
  }
  return blocks(marked.lexer(markdown, { gfm: true }));
}

export function buildPdfDocument(chat: PdfChat, labels: PdfLabels = {}): TDocumentDefinitions {
  const content: Content[] = [];
  if (chat.title) content.push({ text: chat.title, fontSize: 25, bold: true, margin: [0, 0, 0, 8] });
  for (const message of chat.messages) {
    const label = messageLabel(message.role, labels);
    if (label) content.push({ headlineLevel: 1, text: label, bold: true, color: '#176650', fontSize: 9, margin: [0, 14, 0, 7] });
    content.push(...markdownBlocks(message.markdown));
    for (const image of message.images) {
      if (image.data) content.push({ image: image.data, fit: [475, 420], margin: [0, 8, 0, 6] });
    }
    for (const name of message.attachments) content.push({ text: name, fontSize: 9, color: '#68736d' });
  }
  return {
    // pdfmake replaces empty strings with its own branding; whitespace keeps these fields blank.
    info: { ...(chat.title ? { title: chat.title } : {}), creator: ' ', producer: ' ' },
    pageSize: 'A4', pageMargins: [48, 48, 48, 48],
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.25, color: '#24312b' },
    content,
    pageBreakBefore: (node, queries) => Boolean(node.headlineLevel && queries.getFollowingNodesOnPage().length === 0),
  };
}
