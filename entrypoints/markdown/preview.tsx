import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { applyMdxFrontmatter, jsonToMarkdown, markdownTitle, selectMarkdownMessages, type ParsedConversation, type MarkdownSettings } from '@/lib/markdown-export';
import { exportPageMessage } from '@/lib/export-page-message';
import { FontSize } from '../pdf/font-size';
import './style.css';

function App() {
  const [chat, setChat] = useState<ParsedConversation>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [settings, setSettings] = useState<MarkdownSettings>({ userLabel: 'USER', assistantLabel: 'ASSISTANT', markdownExtension: '.md', mdxFrontmatter: '---\ntitle: "{{title}}"\n---' });
  const [includeImages, setIncludeImages] = useState(true);
  const [fontSize, setFontSize] = useState(10);
  const [showTitle, setShowTitle] = useState(true);
  const [showPromptLabels, setShowPromptLabels] = useState(true);
  const [showExcluded, setShowExcluded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError('');
      const tabId = Number(new URLSearchParams(location.search).get('tab'));
      if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('Open a saved ChatGPT conversation and choose Select messages from the extension.');
      const [response, stored] = await Promise.all([
        exportPageMessage<{ chat?: ParsedConversation; error?: string }>({ message: 'prepareMarkdown', tabId }),
        chrome.storage.sync.get(['userLabel', 'assistantLabel', 'markdownExtension', 'mdxFrontmatter']),
      ]);
      if (response.error) throw new Error(response.error);
      if (!response.chat || !Array.isArray(response.chat.messages)) throw new Error('The export service returned an invalid conversation. Reload the extension and try again.');
      if (!active) return;
      setChat(response.chat);
      setSelected(new Set(response.chat.messages.map((_, i) => i)));
      setSettings(s => ({
        userLabel: typeof stored.userLabel === 'string' ? stored.userLabel : s.userLabel,
        assistantLabel: typeof stored.assistantLabel === 'string' ? stored.assistantLabel : s.assistantLabel,
        markdownExtension: stored.markdownExtension === '.mdx' ? '.mdx' : '.md',
        mdxFrontmatter: typeof stored.mdxFrontmatter === 'string' ? stored.mdxFrontmatter : s.mdxFrontmatter,
      }));
      setStatus('Ready. Choose the messages you want to keep.');
      if (response.chat.title) document.title = response.chat.title;
    }
    void load().catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  const subset = useMemo(() => chat && selectMarkdownMessages(chat, selected), [chat, selected]);
  const userLabel = showPromptLabels ? settings.userLabel : '';
  const assistantLabel = showPromptLabels ? settings.assistantLabel : '';
  const text = useMemo(() => subset ? applyMdxFrontmatter(jsonToMarkdown(subset, userLabel, assistantLabel, includeImages, showTitle), subset.title || 'untitled', settings.markdownExtension, settings.mdxFrontmatter) : '', [subset, settings, userLabel, assistantLabel, includeImages, showTitle]);
  async function output(copy: boolean) {
    if (!subset || !selected.size || busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      if (copy) await navigator.clipboard.writeText(text);
      else {
        const response = await exportPageMessage<{ success?: boolean; error?: string }>({ message: 'downloadSelectedMarkdown', chat: subset, options: { ...settings, userLabel, assistantLabel, includeImages, showTitle } });
        if (!response.success) throw new Error(response.error || 'Download failed.');
      }
      setStatus(copy ? 'Copied Markdown.' : 'Download started.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const disabled = loading || !chat || busy || !selected.size;
  const allSelected = !!chat?.messages.length && selected.size === chat.messages.length;
  return <>
    <header className="export-ui toolbar">
      <div><h1>Export Markdown</h1><p>{chat ? `${selected.size} of ${chat.messages.length} messages selected` : 'Preview and customize your conversation'}</p></div>
      <div className="toolbar-actions"><button className="copy" disabled={disabled} onClick={() => void output(true)}>Copy</button><button className="download" disabled={disabled} onClick={() => void output(false)}>{busy ? 'Preparing…' : 'Download'}<span aria-hidden="true"> ↓</span></button></div>
    </header>
    <div className="workspace">
      <aside className="export-ui sidebar">
        <p className="status" role={error ? 'alert' : 'status'} aria-live="polite">{error || (loading ? 'Loading your conversation…' : status)}</p>
        {!chat && !loading && error && <button onClick={() => setAttempt(value => value + 1)}>Retry</button>}
      </aside>
      <main className="document" aria-label="Raw Markdown conversation" style={{ '--document-font-size': `${fontSize}px` } as CSSProperties}>
        <aside className="export-ui message-selector bulk-selector"><label className="selection-actions"><input type="checkbox" disabled={!chat?.messages.length || busy || loading} checked={allSelected} ref={element => { if (element) element.indeterminate = selected.size > 0 && !allSelected; }} onChange={e => setSelected(e.target.checked ? new Set(chat?.messages.map((_, i) => i)) : new Set())} />{allSelected ? 'Deselect all' : 'Select all'}</label></aside>
        {!chat && <p className="export-ui loading">{loading ? 'Preparing your preview…' : 'Your conversation could not be loaded.'}</p>}
        {showTitle && chat?.title && <pre className="raw-markdown document-title">{markdownTitle(chat.title)}</pre>}
        <div className="message-list">{chat?.messages.map((message, i) => {
          const included = selected.has(i);
          if (!showExcluded && !included) return null;
          const label = (message.role === 'user' ? settings.userLabel : settings.assistantLabel).trim();
          return <section key={i} className={`message ${included ? '' : 'excluded'}`} data-message-index={i}>
            <aside className="export-ui message-selector"><label className="include-control"><input type="checkbox" disabled={busy} checked={included} aria-label={`Include message ${i + 1}${label ? ` (${label})` : ''}`} onChange={() => setSelected(previous => { const next = new Set(previous); if (next.has(i)) next.delete(i); else next.add(i); return next; })} /><span>{label || `Message ${i + 1}`}</span></label></aside>
            <div className="message-content"><pre className="raw-markdown">{jsonToMarkdown({ ...chat, messages: [message] }, userLabel, assistantLabel, includeImages)}</pre></div>
          </section>;
        })}</div>
      </main>
      <aside className="export-ui markdown-help" aria-label="Markdown export options">
        <p className="format-note">Inspect raw Markdown and choose the messages to export. Copy includes text only; Download can bundle available files.</p>
        <label className="hide-toggle"><input type="checkbox" disabled={busy} checked={showTitle} onChange={e => setShowTitle(e.target.checked)} /><span>Show title</span></label>
        <label className="hide-toggle"><input type="checkbox" disabled={busy} checked={showPromptLabels} onChange={e => setShowPromptLabels(e.target.checked)} /><span>Show prompt labels</span></label>
        <label className="hide-toggle"><input type="checkbox" checked={showExcluded} onChange={e => setShowExcluded(e.target.checked)} /><span>Show excluded messages</span></label>
        {Boolean(chat?.images?.length || chat?.attachments?.length || chat?.unsupported_assets?.length) && <label className="hide-toggle"><input type="checkbox" disabled={busy} checked={includeImages} onChange={e => setIncludeImages(e.target.checked)} /><span>Include images and attachments</span></label>}
        <FontSize value={fontSize} onChange={setFontSize} />
        <p className="format-note">Font size affects this preview only, not copied or downloaded Markdown.</p>
      </aside>
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
