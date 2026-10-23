export async function showPageExportSuccess(options: { afterPrint?: boolean } = {}) {
  const preferences = await chrome.storage.local.get(['hideExportSuccessMessage']);
  if (preferences.hideExportSuccessMessage === true) return;
  const id = 'chatgpt-backup-export-success';
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  host.className = 'export-ui';
  host.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;max-width:calc(100vw - 40px)';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    *{box-sizing:border-box} section{position:relative;width:320px;max-width:100%;padding:22px;border:2px solid #9fe3d5;border-radius:14px;background:#f4fcf8;color:#215145;font:14px/1.5 system-ui,sans-serif;text-align:center;box-shadow:0 8px 32px #0003;max-height:calc(100vh - 40px);overflow:auto}
    h2{font-size:18px;margin:0 20px 10px}p{margin:8px 0}a{color:#007e62}button{cursor:pointer;font:inherit;color:inherit} .close{position:absolute;right:10px;top:8px;border:0;background:none;font-size:22px}.coffee{display:inline-block;padding:8px 12px;margin:8px 0;border:2px solid #9fe3d5;border-radius:8px;background:white;text-decoration:none;font-weight:600;transition:background-color 150ms,border-color 150ms,box-shadow 150ms}.coffee:hover{background:#c6f0e5;border-color:#6bceb7;box-shadow:0 2px 6px #21514520}.coffee:focus-visible{outline:2px solid #007e62;outline-offset:3px}img{display:block;margin:8px auto;background:white}.hide{border:0;background:none;text-decoration:underline;margin-top:10px}
  `;
  const panel = document.createElement('section');
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-label', options.afterPrint ? 'Thanks for using ChatGPT Backup Tool' : 'Export successful');
  // All markup and URLs are extension-owned constants, never conversation content.
  panel.innerHTML = `<button class="close" aria-label="Dismiss success message">×</button><h2>Export Success!</h2><p>Built with ❤️. Thanks for using.</p><a href="https://chromewebstore.google.com/detail/chatgpt-backup-chatgpt-to/majboohgjfdnegkhadaialohhlimolcc/reviews" target="_blank" rel="noopener noreferrer">Send feedback</a><br><a class="coffee" href="https://buymeacoffee.com/shockerovi7" target="_blank" rel="noopener noreferrer">☕ Buy Me a Coffee</a><canvas width="144" height="144" aria-label="QR code linking to Buy Me a Coffee for shockerovi7" role="img"></canvas><p>Scan to support from your phone.</p>`;
  if (options.afterPrint) panel.querySelector('h2')!.textContent = 'Thanks for using ChatGPT Backup Tool!';
  panel.querySelector('.close')!.addEventListener('click', () => host.remove());
  const hide = document.createElement('a');
  hide.className = 'hide';
  hide.textContent = 'Buy a coffee & Don’t show this again';
  hide.href = 'https://buymeacoffee.com/shockerovi7';
  hide.target = '_blank';
  hide.rel = 'noopener noreferrer';
  hide.addEventListener('click', () => {
    void chrome.storage.local.set({ hideExportSuccessMessage: true });
    host.remove();
  });
  panel.append(hide);
  root.append(style, panel);
  document.documentElement.append(host);
  // Fetch through extension messaging to avoid exposing assets to every website.
  try {
    const response = await chrome.runtime.sendMessage({ message: 'getSupportQr' });
    if (typeof response?.dataUrl === 'string') {
      const image = new Image();
      image.onload = () => {
        const canvas = panel.querySelector('canvas')!;
        canvas.getContext('2d')?.drawImage(image, 0, 0, 144, 144);
      };
      image.src = response.dataUrl;
    }
  } catch { /* The donation link remains usable if the QR cannot load. */ }
}
