import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { messageLabel, selectMessages, type ExportConversation, type ExportLabels } from '@/lib/export-document';
import { Markdown } from './markdown';
import { FontSize, NumericSetting } from './font-size';
import { showPageExportSuccess } from '@/lib/page-export-success';
import './style.css';

function Preview() {
  const [chat, setChat] = useState<ExportConversation>();
  const [labels, setLabels] = useState<ExportLabels>({});
  const [included, setIncluded] = useState(new Set<number>());
  const [status, setStatus] = useState('Loading your conversation…');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fontSize, setFontSize] = useState(10);
  const [pageMargin, setPageMargin] = useState(18);
  const [showTitle, setShowTitle] = useState(true);
  const [showPromptLabels, setShowPromptLabels] = useState(true);
  const [showExcluded, setShowExcluded] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const tabId = Number(new URLSearchParams(location.search).get('tab'));
      if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('Open a saved ChatGPT conversation and choose PDF from the extension.');
      const [savedLabels, response] = await Promise.all([
        chrome.storage.sync.get(['userLabel', 'assistantLabel']),
        chrome.runtime.sendMessage({ message: 'preparePdf', tabId }) as Promise<{ chat?: ExportConversation; error?: string }>,
      ]);
      if (response.error || !response.chat) throw new Error(response.error || 'Could not load conversation.');
      if (!active) return;
      setLabels(savedLabels);
      setChat(response.chat);
      setIncluded(new Set(response.chat.messages.map((_, i) => i)));
      setStatus(response.chat.messages.length ? 'Ready. Choose the messages you want to keep.' : 'This conversation has no messages to export.');
      if (response.chat.title) document.title = response.chat.title;
    }
    load().catch(reason => { if (active) { setError(true); setStatus(reason instanceof Error ? reason.message : String(reason)); } });
    const onSettingsChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'sync') return;
      setLabels(current => ({ ...current,
        ...('userLabel' in changes ? { userLabel: typeof changes.userLabel.newValue === 'string' ? changes.userLabel.newValue : undefined } : {}),
        ...('assistantLabel' in changes ? { assistantLabel: typeof changes.assistantLabel.newValue === 'string' ? changes.assistantLabel.newValue : undefined } : {}),
      }));
    };
    chrome.storage.onChanged.addListener(onSettingsChanged);
    return () => { active = false; chrome.storage.onChanged.removeListener(onSettingsChanged); };
  }, []);

  const selectedChat = useMemo(() => chat && selectMessages(chat, included), [chat, included]);
  const missingImages = selectedChat?.messages.reduce((count, message) => count + message.images.filter(image => !image.data).length, 0) || 0;

  function toggle(index: number) {
    setIncluded(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
    setStatus('Selection updated. Save as PDF when you’re ready.');
    setError(false);
  }

  async function print() {
    if (!selectedChat?.messages.length || busy) return;
    setBusy(true); setError(false);
    try {
      await document.fonts.ready;
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.message:not(.excluded) img'))
        .map(image => image.decode().catch(() => undefined)));
      // afterprint also fires on Cancel; use a neutral thank-you, not a success claim.
      window.addEventListener('afterprint', () => {
        void showPageExportSuccess({ afterPrint: true }).catch(() => {});
      }, { once: true });
      window.print();
    } catch (reason) {
      setError(true); setStatus(`Could not open print dialog: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally { setBusy(false); }
  }

  return <>
    <header className="export-ui toolbar">
      <div><h1>Export to PDF</h1><p>Preview and customize your conversation</p></div>
      <button className="download" onClick={print} disabled={!included.size || !chat || busy}>{busy ? 'Preparing…' : 'Save as PDF'}<span aria-hidden="true"> ↓</span></button>
    </header>
    <div className="workspace">
      <aside className="export-ui sidebar">
        {error && <p className="status" role="alert" aria-live="polite">{status}</p>}
        {missingImages > 0 && <p className="notice">{missingImages} image(s) are unavailable and will be omitted.</p>}
      </aside>
      <main className="document" aria-label="Conversation preview" style={{ '--document-font-size': `${fontSize}px`, '--page-padding': `${pageMargin}mm` } as CSSProperties}>
          <aside className="export-ui message-selector bulk-selector">
            <label className="selection-actions"><input type="checkbox" disabled={!chat?.messages.length || busy} checked={!!chat?.messages.length && included.size === chat.messages.length} onChange={event => {
              setIncluded(event.target.checked ? new Set(chat?.messages.map((_, i) => i)) : new Set());
            }} />{chat?.messages.length && included.size === chat.messages.length ? 'Deselect all' : 'Select all'}</label>
          </aside>
        {showTitle && chat?.title && <h1 className="document-title">{chat.title}</h1>}
        {!chat && <p className="export-ui loading">{error ? 'Your conversation could not be loaded.' : 'Preparing your preview…'}</p>}
        <div className="message-list">
        {chat?.messages.map((message, index) => {
          const selected = included.has(index);
          if (!showExcluded && !selected) return null;
          const label = messageLabel(message.role, labels);
          return <section key={index} className={`message ${selected ? '' : 'excluded'}`} data-message-index={index}>
            <aside className="export-ui message-selector">
              <label className="include-control"><input type="checkbox" checked={selected} disabled={busy} onChange={() => toggle(index)} aria-label={`Include message ${index + 1}${label ? ` (${label})` : ''}`} /><span>{label || `Message ${index + 1}`}</span></label>
            </aside>
            {showPromptLabels && <div className="message-heading">{label && <div className="role-label">{label}</div>}
            </div>}
            <div className="message-content"><Markdown text={message.markdown} />
              {message.images.filter(image => image.data).map((image, i) => <img onError={event => { event.currentTarget.hidden = true; }} className="conversation-image" key={i} src={image.data} alt={image.name} />)}
              {message.attachments.map((name, i) => <p className="attachment" key={i}>{name}</p>)}
            </div>
          </section>;
        })}
        </div>
      </main>
      <aside className="export-ui print-help" aria-label="PDF printing tips">
        <p className="format-note">In the print dialog, choose <strong>Save as PDF</strong>. Turn off <strong>Headers and footers</strong> to omit Chrome’s date, URL, and page numbers.</p>
        <label className="hide-toggle"><input type="checkbox" checked={showTitle} onChange={event => setShowTitle(event.target.checked)} /><span>Show title</span></label>
        <label className="hide-toggle"><input type="checkbox" checked={showPromptLabels} onChange={event => setShowPromptLabels(event.target.checked)} /><span>Show prompt labels</span></label>
        <label className="hide-toggle"><input type="checkbox" checked={showExcluded} onChange={event => setShowExcluded(event.target.checked)} /><span>Show excluded messages</span></label>
        <FontSize value={fontSize} onChange={setFontSize} />
        <NumericSetting value={pageMargin} onChange={setPageMargin} id="page-margin" label="Page margin" unit="mm" min={0} max={50} presets={[0, 5, 10, 15, 18, 20, 25, 30]} />
        <style>{`@page { margin: ${pageMargin}mm; }`}</style>
      </aside>
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
