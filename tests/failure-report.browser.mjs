// Run after npm run build. Exercises the real popup and background with synthetic ChatGPT responses.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const profile = await mkdtemp(join(tmpdir(), 'failure-report-'));
const extension = resolve('.output/chrome-mv3');
const browser = spawn(process.env.CHROMIUM_PATH || '/usr/bin/chromium', ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const sockets = [];
async function connect(url) {
  const ws = new WebSocket(url); sockets.push(ws);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ({ data }) => { const result = JSON.parse(data); const callback = pending.get(result.id); if (callback) { pending.delete(result.id); result.error ? callback.reject(new Error(JSON.stringify(result.error))) : callback.resolve(result.result); } });
  const command = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  return { command, evaluate };
}
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Timed out waiting for extension');
}
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = ''; const timer = setTimeout(() => reject(new Error(log)), 15000);
    browser.stderr.on('data', chunk => { log += chunk; const match = log.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    browser.on('exit', code => { clearTimeout(timer); reject(new Error(`Chromium exited ${code}: ${log}`)); });
  });
  const http = endpoint.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '');
  const targets = await waitFor(async () => { const list = await (await fetch(http + '/json/list')).json(); return list.some(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')) && list; });
  const worker = targets.find(t => t.type === 'service_worker');
  const sw = await connect(worker.webSocketDebuggerUrl);
  await sw.evaluate(`globalThis.fetch = async url => { if (String(url).endsWith('/api/auth/session')) return new Response(JSON.stringify({accessToken: 'synthetic-token'})); throw new Error('synthetic private failure'); };`);
  const page = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  const url = new URL(worker.url);
  await page.command('Page.navigate', { url: `${url.protocol}//${url.host}/popup.html` });
  await waitFor(() => page.evaluate(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Download')`));
  await page.evaluate(`chrome.tabs.query = (_query, callback) => callback([{ id: 1, url: 'https://chatgpt.com/c/synthetic-chat' }]); navigator.clipboard.writeText = async text => { globalThis.copiedReport = text; };`);
  await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Download').click()`);
  await waitFor(() => page.evaluate(`Boolean(document.querySelector('button[title="Copy technical report and open an email draft"]'))`));
  await page.evaluate(`document.querySelector('button[title="Copy technical report and open an email draft"]').click()`);
  const report = await waitFor(() => page.evaluate('globalThis.copiedReport'));
  assert.match(report, /Failure stage: FETCH_CONVERSATION/);
  assert.doesNotMatch(report, /synthetic private failure|synthetic-token|synthetic-chat/);
  console.log('Real popup failure report passed.');
} finally {
  for (const ws of sockets) ws.close();
  browser.kill();
  await new Promise(resolve => browser.once('exit', resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
