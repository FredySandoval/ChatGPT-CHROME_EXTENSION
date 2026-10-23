// Synthetic browser smoke test. Run pnpm build first; requires Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, join } from 'node:path';
import { spawn } from 'node:child_process';
const directory = await mkdtemp(join(tmpdir(), 'markdown-selector-test-'));
const output = resolve('.output/chrome-mv3');
const image = {fileId: 'file-1', assetPointer: 'file-service://file-1', name: 'Image.png'};
const fixture = {conversation_id: 'chat-1', title: 'Fixture', images: [image], messages: [
 {role: 'user', content: ['# Literal heading\n\n<b>literal HTML</b>'], metadata: {}, images: [image]},
 {role: 'assistant', content: ['```js\nconst answer = 42;\n```'], metadata: {}}
]};
const mock = `window.copied = ''; window.requests = []; window.failCopy = false;
Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => {if (window.failCopy) throw new Error('Clipboard blocked'); window.copied = text;}}});
window.loadFailure = new URLSearchParams(location.search).get('failure');
window.chrome = {runtime: {sendMessage: (request, callback) => {window.requests.push(request); setTimeout(() => callback(window.loadFailure ? undefined : request.message === 'prepareMarkdown' ? {chat: ${JSON.stringify(fixture)}} : {success: true}), 10);}}, storage: {sync: {get: async () => ({userLabel: 'Human', assistantLabel: 'Helper'})}}};`;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/test-runtime.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(mock); return; }
    const file = resolve(output, '.' + path);
    if (!file.startsWith(output + '/')) { response.writeHead(403).end(); return; }
    let data = await readFile(file);
    if (path === '/markdown.html') data = Buffer.from(data.toString().replace('<head>', '<head><script src="/test-runtime.js"></script>'));
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
  await command('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/markdown.html?tab=1`});
  await until('document.querySelectorAll("section").length === 2');
  assert.equal(await evaluate('document.querySelectorAll("pre b, pre h1").length'), 0);
  assert.match(await evaluate('document.querySelector(".message pre").textContent'), /# Literal heading/);
  assert.equal(await evaluate('requests.length'), 1, 'Loading must not fetch assets');
  assert.equal(await evaluate('document.querySelector(".document-title").textContent'), '# Fixture\n\n');
  assert.match(await evaluate('document.querySelector(".message pre").textContent'), /^Human/);
  await evaluate('document.querySelector(".copy").click()');
  await until('copied.startsWith("# Fixture")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".message pre")).fontSize'), '10px');
  await evaluate(`window.originalCopy = copied; document.querySelector('.font-size-trigger').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false }))`);
  await until('document.querySelectorAll("[role=menuitemradio]").length > 0');
  await evaluate('Array.from(document.querySelectorAll("[role=menuitemradio]")).find(item => item.textContent.trim() === "18").click()');
  await until('getComputedStyle(document.querySelector(".message pre")).fontSize === "18px"');
  await evaluate('document.querySelector(".copy").click()');
  await until('!document.querySelector(".copy").disabled');
  assert.equal(await evaluate('copied === originalCopy'), true, 'Viewing font size must not affect exported text');
  await evaluate('document.querySelectorAll(".markdown-help input")[0].click(); document.querySelectorAll(".markdown-help input")[1].click()');
  assert.equal(await evaluate('Boolean(document.querySelector(".document-title"))'), false);
  assert.doesNotMatch(await evaluate('document.querySelector(".message pre").textContent'), /^Human/);
  await evaluate('document.querySelectorAll("header button")[0].click()');
  await until('copied.includes("images/image.png")');
  await evaluate('document.querySelector("section input").click()');
  await evaluate('document.querySelectorAll("header button")[0].click()');
  await until('copied.startsWith("```js")');
  assert.doesNotMatch(await evaluate('copied'), /images\//);
  await evaluate('document.querySelectorAll(".markdown-help input")[2].click()');
  assert.equal(await evaluate('document.querySelectorAll("section").length'), 1);
  await evaluate('document.querySelector(".bulk-selector input").click()');
  assert.equal(await evaluate('document.querySelectorAll("section").length'), 2);
  await evaluate('document.querySelector(".bulk-selector input").click()');
  assert.equal(await evaluate('document.querySelector("header button").disabled'), true);
  await evaluate('document.querySelector(".bulk-selector input").click(); window.failCopy = true');
  await evaluate('document.querySelector("header button").click()');
  await until('document.querySelector("[role=alert]")?.textContent.includes("Clipboard blocked")');
  assert.equal(await evaluate('document.querySelectorAll("section input:checked").length'), 2);
  await evaluate('document.querySelectorAll("header button")[1].click()');
  await until('requests.length === 2');
  assert.equal(await evaluate('requests[1].chat.messages.length'), 2);
  assert.equal(await evaluate('requests[1].options.showTitle'), false);
  assert.equal(await evaluate('requests[1].options.userLabel'), '');
  assert.equal(await evaluate('requests[1].options.assistantLabel'), '');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".download")).backgroundColor'), 'rgb(36, 93, 68)', 'Use PDF workspace button styling');
  await command('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/markdown.html?tab=1&failure=missing`});
  await until('document.querySelector("[role=alert]")?.textContent.includes("export service did not respond")');
  assert.equal(await evaluate('document.querySelector(".copy").disabled'), true);
  assert.equal(await evaluate('document.body.innerText.includes("0 of 0")'), false);
  await evaluate('window.loadFailure = null; document.querySelector(".sidebar button").click()');
  await until('document.querySelectorAll(".message").length === 2');
  assert.match(await evaluate('document.querySelector("header p").textContent'), /2 of 2/);
  console.log('Markdown browser checks passed.');
} finally { ws?.close(); browser.kill(); server.close(); }
