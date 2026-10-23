// Real extension page -> real service worker messaging. Only ChatGPT APIs/source tab are synthetic.
// Run pnpm build first. Requires Chromium with unpacked extension support.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
const profile = await mkdtemp(join(tmpdir(), 'markdown-extension-'));
const extension = resolve('.output/chrome-mv3');
const browser = spawn(process.env.CHROMIUM_PATH || '/usr/bin/chromium', ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
const sockets = [];
async function connect(url) {
  const ws = new WebSocket(url); sockets.push(ws);
  await new Promise((resolve, reject) => {ws.addEventListener('open', resolve, {once: true}); ws.addEventListener('error', reject, {once: true});});
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ({data}) => { const result = JSON.parse(data); const callback = pending.get(result.id); if (callback) { pending.delete(result.id); result.error ? callback.reject(new Error(JSON.stringify(result.error))) : callback.resolve(result.result); } });
  const command = (method, params = {}) => new Promise((resolve, reject) => {pending.set(++id, {resolve, reject}); ws.send(JSON.stringify({id, method, params}));});
  const evaluate = async expression => {const r = await command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value;};
  return {command, evaluate};
}
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = ''; const timer = setTimeout(() => reject(new Error(log)), 15000);
    browser.stderr.on('data', chunk => {log += chunk; const match = log.match(/DevTools listening on (ws:\/\/\S+)/); if (match) {clearTimeout(timer); resolve(match[1]);}});
    browser.on('exit', code => {clearTimeout(timer); reject(new Error(`Chromium exited ${code}: ${log}`));});
  });
  const http = endpoint.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '');
  let targets;
  let worker;
  for (let i = 0; i < 100; i++) {
    targets = await (await fetch(http + '/json/list')).json();
    worker = targets.find(target => target.type === 'service_worker' && target.url.startsWith('chrome-extension://'));
    if (worker) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(worker, 'Unpacked extension service worker did not start');
  const sw = await connect(worker.webSocketDebuggerUrl);
  const message = (role, text, time) => ({author: {role}, content: {content_type: 'text', parts: [text]}, metadata: {}, create_time: time});
  const raw = {conversation_id: 'synthetic-chat-1', title: 'Synthetic current chat', current_node: 'answer', mapping: {root: {parent: null}, prompt: {parent: 'root', message: message('user', '# Literal Markdown', 20)}, answer: {parent: 'prompt', message: message('assistant', '```js\n42\n```', 10)}}};
  await sw.evaluate(`chrome.tabs.get = async id => ({id, url: 'https://chatgpt.com/c/synthetic-chat-1'}); globalThis.apiCalls = []; globalThis.fetch = async url => { apiCalls.push(String(url)); if (String(url).endsWith('/api/auth/session')) return new Response(JSON.stringify({accessToken: 'synthetic-token'})); if (String(url).endsWith('/backend-api/conversation/synthetic-chat-1')) return new Response(JSON.stringify(${JSON.stringify(raw)})); throw new Error('Unexpected network request: ' + url); };`);
  const page = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  // URL.origin is 'null' for chrome-extension URLs in Node; retain scheme and host explicitly.
  const url = new URL(worker.url);
  await page.command('Page.navigate', {url: `${url.protocol}//${url.host}/markdown.html?tab=1`});
  let count = 0;
  for (let i = 0; i < 100; i++) {
    count = await page.evaluate('document.querySelectorAll(".message").length');
    if (count === 2) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(count, 2, await page.evaluate('document.body.innerText'));
  assert.match(await page.evaluate('document.querySelector("header p").textContent'), /2 of 2/);
  assert.match(await page.evaluate('document.querySelector(".message pre").textContent'), /# Literal Markdown/);
  assert.equal(await sw.evaluate('apiCalls.length'), 2, 'Only session and conversation metadata fetched');
  console.log('Real extension Markdown loading passed.');
} finally { for (const ws of sockets) ws.close(); browser.kill(); }
