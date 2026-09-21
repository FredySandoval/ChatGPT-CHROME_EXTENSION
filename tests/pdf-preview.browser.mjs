// Isolated browser smoke test: synthetic conversation, no real account or downloads.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'chatgpt-preview-test-'));
const output = resolve('.output/chrome-mv3');
const testImage = 'data:image/png;base64,' + (await readFile(new URL('./fixtures/export-image.png', import.meta.url))).toString('base64');
const fixture = {
  title: 'Research notes: a readable document',
  messages: [
    { role: 'user', markdown: 'What makes a useful document? REMOVE_THIS_PROMPT', images: [], attachments: [] },
    { role: 'assistant', markdown: '# Design for reading\n\nUse **clear headings**, comfortable spacing, and [source links](https://example.com).\n\n```javascript\nfunction exportConversation(messages) {\n  return messages.filter(message => message.included);\n}\n```\n\n| Feature | Benefit |\n| --- | --- |\n| HTML | Flexible layout |\n| Selection | Only the messages you need |\n\n- Keep the wording.\n- Respect the user’s labels.\n\n$$E = mc^2$$\n\n<script>window.injected = true</script>\n\n[unsafe](javascript:alert(1))', images: [], attachments: [] },
    { role: 'user', markdown: 'Can I restore an excluded message?', images: [], attachments: [] },
    { role: 'assistant', markdown: 'Yes. Include it again before downloading.', images: [{name: 'Example chart', data: testImage}], attachments: [] },
  ],
};
const mock = `window.downloadsCaptured = []; window.settingsListeners = []; window.chrome = {
 runtime: { getURL: path => location.origin + path, sendMessage: async () => ({chat: ${JSON.stringify(fixture)}}) },
 storage: { sync: {get: async () => ({userLabel: 'Fredy', assistantLabel: 'Assistant'})}, onChanged: {addListener: fn => settingsListeners.push(fn), removeListener: () => {}} },
 downloads: { download: async ({url}) => { const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer()); let data=''; for(let i=0;i<bytes.length;i+=8192)data+=String.fromCharCode(...bytes.subarray(i,i+8192)); downloadsCaptured.push(btoa(data)); return downloadsCaptured.length; }, search: async () => [{state:'complete'}], onChanged: {addListener: () => {},removeListener: () => {}} }
};`;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/test-runtime.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(mock); return; }
    const file = resolve(output, '.' + path);
    if (!file.startsWith(output + '/')) { response.writeHead(403).end(); return; }
    let data = await readFile(file);
    if (path === '/pdf.html') data = Buffer.from(data.toString().replace('<head>', '<head><script src="/test-runtime.js"></script>'));
    response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' }[extname(file)] || 'application/octet-stream');
    response.setHeader('Content-Security-Policy', "script-src 'self'; object-src 'self';");
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const browser = spawn(process.env.CHROMIUM_PATH || '/usr/bin/chromium', ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${directory}/profile`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('Chromium startup timed out: ' + log.slice(-1200))), 15000);
    browser.stderr.on('data', chunk => { log += chunk; const match = log.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    browser.on('exit', code => { clearTimeout(timer); reject(new Error(`Chromium exited ${code}: ${log.slice(-1200)}`)); });
  });
  const debugHttp = endpoint.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '');
  const tabs = await (await fetch(debugHttp + '/json/list')).json();
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ({ data }) => { const result = JSON.parse(data); if (pending.has(result.id)) { const { resolve, reject } = pending.get(result.id); pending.delete(result.id); result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result.result); } });
  const command = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const until = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out waiting for: ' + expression + '\n' + await evaluate('document.body.innerText')); };
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/pdf.html?tab=1` });
  await until('document.querySelectorAll(".message").length === 4');
  await until('document.querySelector(".conversation-image")?.naturalWidth > 0');
  assert.equal(await evaluate('downloadsCaptured.length'), 0, 'Opening the preview must not start a download');
  assert.equal(await evaluate('document.querySelector(".role-label").textContent'), 'Fredy');
  assert.equal(await evaluate('Boolean(window.injected)'), false);
  assert.equal(await evaluate('document.querySelectorAll("a[href^=javascript]").length'), 0);
  assert.equal(await evaluate('document.querySelectorAll(".markdown table").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll("pre code").length'), 1);
  await evaluate('document.querySelector(".include-control input").click()');
  await until('document.querySelectorAll(".excluded").length === 1');
  await evaluate('document.querySelector(".hide-toggle input").click()');
  await until('document.querySelectorAll(".message").length === 3');
  await evaluate('document.querySelectorAll(".selection-actions button")[0].click()');
  await until('document.querySelectorAll(".message").length === 4');
  await evaluate('document.querySelectorAll(".selection-actions button")[1].click()');
  await until('document.querySelector(".download").disabled');
  await evaluate('document.querySelectorAll(".selection-actions button")[0].click()');
  await until('document.querySelectorAll(".message").length === 4');
  await evaluate('settingsListeners.forEach(fn => fn({userLabel:{newValue:"READER"}}, "sync"))');
  await until('document.querySelector(".role-label").textContent === "READER"');
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, 'preview.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate('document.querySelector(".include-control input").click()');
  await until('document.querySelectorAll(".message").length === 3');
  await evaluate('document.querySelector(".download").click()');
  await until('downloadsCaptured.length === 1 && !document.querySelector(".download").disabled');
  const pdf = join(directory, 'selection.pdf');
  await writeFile(pdf, Buffer.from(await evaluate('downloadsCaptured[0]'), 'base64'));
  const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  assert.ok(!text.includes('REMOVE_THIS_PROMPT'));
  assert.ok(text.includes('Design for reading'));
  assert.ok(text.includes('READER'));
  assert.ok(!text.includes('EXPORT PREVIEW'));
  assert.ok(!text.includes('Included'));
  assert.match(execFileSync('pdfimages', ['-list', pdf], {encoding: 'utf8'}), /image\s+720\s+200/);
  await evaluate('document.querySelectorAll(".selection-actions button")[0].click()');
  await until('document.querySelectorAll(".message").length === 4');
  await evaluate('document.querySelector(".download").click()');
  await until('downloadsCaptured.length === 2 && !document.querySelector(".download").disabled');
  await writeFile(pdf, Buffer.from(await evaluate('downloadsCaptured[1]'), 'base64'));
  assert.ok(execFileSync('pdftotext', [pdf, '-'], {encoding: 'utf8'}).includes('REMOVE_THIS_PROMPT'));
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await until('window.innerWidth === 390');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Preview must fit a narrow viewport');
  const mobile = await command('Page.captureScreenshot', {format: 'png'});
  await writeFile(join(directory, 'preview-mobile.png'), Buffer.from(mobile.data, 'base64'));
  console.log(`Browser preview checks passed. Screenshot: ${directory}/preview.png`);
} finally {
  ws?.close(); browser.kill(); server.close();
}
