import { Fragment, useMemo, type ReactNode } from 'react';
import { marked, type Token } from 'marked';
import { decodeHTMLStrict } from 'entities';
import { safeExportLink } from '@/lib/export-document';

// Render Markdown as semantic HTML. React escapes content; raw HTML never executes.
function renderTokens(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => {
    let content: ReactNode;
    const children = 'tokens' in token && token.tokens ? renderTokens(token.tokens) : undefined;
    switch (token.type) {
      case 'space': return null;
      // Decode only ordinary text, after parsing, and exactly once. Escape tokens,
      // code and raw HTML must retain their literal content. React still escapes
      // the decoded text, so character references can never introduce elements.
      case 'text': content = children ?? (token.escaped ? token.text : decodeHTMLStrict(token.text)); break;
      case 'heading': {
        const Heading = `h${Math.min(6, token.depth)}` as 'h1';
        content = <Heading>{children}</Heading>; break;
      }
      case 'paragraph': content = <p>{children}</p>; break;
      case 'strong': content = <strong>{children}</strong>; break;
      case 'em': content = <em>{children}</em>; break;
      case 'del': content = <del>{children}</del>; break;
      case 'br': content = <br />; break;
      case 'hr': content = <hr />; break;
      case 'codespan': content = <code>{token.text}</code>; break;
      case 'code': content = <pre><code>{token.text}</code></pre>; break;
      case 'blockquote': content = <blockquote>{children}</blockquote>; break;
      case 'link': content = <a href={safeExportLink(token.href)} target="_blank" rel="noopener noreferrer">{children}</a>; break;
      // Remote image URLs are displayed as links; opening a preview must not contact third-party hosts.
      case 'image': content = <a href={safeExportLink(token.href)} target="_blank" rel="noopener noreferrer">{token.text ? children ?? decodeHTMLStrict(token.text) : token.href}</a>; break;
      case 'list': {
        const items = token.items.map((item: { tokens: Token[]; task?: boolean; checked?: boolean }, i: number) => <li key={i}>
          {item.task && <input type="checkbox" checked={Boolean(item.checked)} readOnly aria-label={item.checked ? 'Completed task' : 'Incomplete task'} />}
          {renderTokens(item.tokens)}
        </li>);
        content = token.ordered ? <ol start={Number(token.start) || 1}>{items}</ol> : <ul>{items}</ul>; break;
      }
      case 'table': content = <div className="table-scroll"><table>
        <thead><tr>{token.header.map((cell: { tokens: Token[] }, i: number) => <th key={i}>{renderTokens(cell.tokens)}</th>)}</tr></thead>
        <tbody>{token.rows.map((row: { tokens: Token[] }[], i: number) => <tr key={i}>{row.map((cell, j) => <td key={j}>{renderTokens(cell.tokens)}</td>)}</tr>)}</tbody>
      </table></div>; break;
      default: content = children ?? ('text' in token ? token.text : token.raw);
    }
    return <Fragment key={index}>{content}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const tokens = useMemo(() => marked.lexer(text, { gfm: true }), [text]);
  return <div className="markdown">{renderTokens(tokens)}</div>;
}
