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
// Keep fixtures synthetic: the original backup is private. Each paragraph tests
// a separate token context, including escapes and exactly-once decoding.
const entityCases = [
  ['minimal&#x20;stack', 'minimal stack'],
  ['A &amp; B &#32; &#x1F980; &copy;', 'A & B   🦀 ©'],
  ['&amp;#x20;', '&#x20;'],
  [String.raw`\&amp;`, '&amp;'],
  ['`&#x20; &amp;`', '&#x20; &amp;'],
  ['&lt;script&gt;window.entityInjected = true&lt;/script&gt;', '<script>window.entityInjected = true</script>'],
  ['&notanentity; &amp &#xZZ;', '&notanentity; &amp &#xZZ;'],
  ['[Link &amp; label](https://example.com)', 'Link & label'],
  ['![Image &amp; label](https://example.com/image.png)', 'Image & label'],
];
fixture.messages[1].markdown += '\n\n' + entityCases.map(([source]) => source).join('\n\n')
  + '\n\n## Heading &amp; text\n\n**Strong &amp; text**\n\n- Item &amp; text\n\n| Entity |\n| --- |\n| Cell &amp; text |';
fixture.messages[1].markdown = fixture.messages[1].markdown.replace('function exportConversation(messages) {', '// Literal &#x20; &amp;\nfunction exportConversation(messages) {');
const mock = `window.printCalls = 0; window.print = () => { window.printCalls++; }; window.settingsListeners = []; window.chrome = {
 runtime: { getURL: path => location.origin + path, sendMessage: async () => ({chat: ${JSON.stringify(fixture)}}) },
 storage: { sync: {get: async () => ({userLabel: 'Fredy', assistantLabel: 'Assistant'})}, onChanged: {addListener: fn => settingsListeners.push(fn), removeListener: () => {}} }
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
  assert.equal(await evaluate('printCalls'), 0, 'Opening the preview must not open the print dialog');
  assert.equal(await evaluate('document.querySelector(".role-label").textContent'), 'Fredy');
  assert.equal(await evaluate('Boolean(window.injected)'), false);
  assert.equal(await evaluate('document.querySelectorAll("a[href^=javascript]").length'), 0);
  assert.equal(await evaluate('document.querySelectorAll(".markdown table").length'), 2);
  const paragraphs = await evaluate('Array.from(document.querySelectorAll(".markdown p"), p => p.textContent)');
  for (const [source, expected] of entityCases) assert.ok(paragraphs.includes(expected), `Entity rendering failed: ${source}`);
  for (const [selector, expected] of [['h2', 'Heading & text'], ['strong', 'Strong & text'], ['li', 'Item & text'], ['td', 'Cell & text']]) {
    assert.ok((await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify('.markdown ' + selector)}), node => node.textContent)`)).includes(expected));
  }
  assert.equal(await evaluate('Boolean(window.entityInjected)'), false);
  assert.equal(await evaluate('document.querySelectorAll(".markdown script").length'), 0);
  assert.ok((await evaluate('document.querySelector("pre code").textContent')).includes('Literal &#x20; &amp;'));
  assert.equal(await evaluate('document.querySelectorAll("pre code").length'), 1);
  const setFontSize = async value => {
    await evaluate(`(() => {
      const input = document.querySelector('#document-font-size');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  };
  for (const size of ['10', '128', '17.5']) {
    await setFontSize(size);
    await until(`getComputedStyle(document.querySelector('.markdown')).fontSize === '${size}px'`);
  }
  for (const invalid of ['', '9', '129']) {
    await setFontSize(invalid);
    await until(`document.querySelector('#document-font-size').value === ${JSON.stringify(invalid)}`);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".markdown")).fontSize'), '17.5px');
    await evaluate(`(() => { const input = document.querySelector('#document-font-size'); input.blur(); input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); })()`);
    await until('document.querySelector("#document-font-size").value === "17.5"');
  }
  await setFontSize('18');
  await until('getComputedStyle(document.querySelector(".markdown")).fontSize === "18px"');
  assert.ok(Math.abs(parseFloat(await evaluate('getComputedStyle(document.querySelector(".markdown h1")).fontSize')) - 30) < .01);
  // Open the actual Radix dropdown, select a preset, then test keyboard dismissal.
  const openFontMenu = async () => {
    await evaluate(`document.querySelector('.font-size-trigger').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false }))`);
    await until('document.querySelectorAll("[role=menuitemradio]").length === 17');
  };
  await openFontMenu();
  assert.ok((await evaluate('Array.from(document.querySelectorAll("[role=menuitemradio]"), item => item.textContent)')).includes('128'));
  await evaluate('Array.from(document.querySelectorAll("[role=menuitemradio]")).find(item => item.textContent === "24").click()');
  await until('getComputedStyle(document.querySelector(".markdown")).fontSize === "24px" && !document.querySelector("[role=menu]")');
  assert.equal(await evaluate('document.querySelector("#document-font-size").value'), '24');
  await openFontMenu();
  await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
  await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
  await until('!document.querySelector("[role=menu]")');
  await setFontSize('18');
  await until('getComputedStyle(document.querySelector(".markdown")).fontSize === "18px"');
  assert.equal(await evaluate('document.querySelector("#page-margin").value'), '18');
  const initialPadding = parseFloat(await evaluate('getComputedStyle(document.querySelector(".document")).paddingLeft'));
  await evaluate(`document.querySelector('#page-margin').parentElement.querySelector('button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))`);
  await until('document.querySelectorAll("[role=menuitemradio]").length === 8');
  await evaluate('Array.from(document.querySelectorAll("[role=menuitemradio]")).find(item => item.textContent === "25").click()');
  await until('document.querySelector("#page-margin").value === "25" && !document.querySelector("[role=menu]")');
  const selectedPadding = await evaluate(`(() => { const style = getComputedStyle(document.querySelector('.document')); return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat); })()`);
  assert.ok(selectedPadding.every(value => Math.abs(value - 25 * 96 / 25.4) < .1), 'Preview must display the selected margin on all four sides');
  assert.ok(selectedPadding[0] > initialPadding);
  // Target the excluded-message setting, not the title/label toggles.
  const excludedToggle = '.print-help > .hide-toggle:last-of-type input';
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(excludedToggle)}).checked`), true);
  await evaluate('document.querySelector(".include-control input").click()');
  await until('document.querySelectorAll(".excluded").length === 1');
  await evaluate(`document.querySelector(${JSON.stringify(excludedToggle)}).click()`);
  await until('document.querySelectorAll(".message").length === 3');
  await evaluate('document.querySelector(".selection-actions input").click()');
  await until('document.querySelectorAll(".message").length === 4');
  await evaluate('document.querySelector(".selection-actions input").click()');
  await until('document.querySelector(".download").disabled');
  await evaluate('document.querySelector(".selection-actions input").click()');
  await until('document.querySelectorAll(".message").length === 4');
  await evaluate('settingsListeners.forEach(fn => fn({userLabel:{newValue:"READER"}}, "sync"))');
  await until('document.querySelector(".role-label").textContent === "READER"');
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, 'preview.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate('document.querySelector(".include-control input").click()');
  await until('document.querySelectorAll(".message").length === 3');
  await evaluate(`document.querySelector(${JSON.stringify(excludedToggle)}).click()`);
  await until('document.querySelectorAll(".excluded").length === 1');
  await evaluate('document.querySelector(".download").click()');
  await until('printCalls === 1 && !document.querySelector(".download").disabled');
  const pdf = join(directory, 'selection.pdf');
  await command('Emulation.setEmulatedMedia', {media: 'print'});
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".toolbar")).display'), 'none');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".markdown")).fontSize'), '18px');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".print-help")).display'), 'none');
  const printed = await command('Page.printToPDF', {printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true});
  await writeFile(pdf, Buffer.from(printed.data, 'base64'));
  await command('Emulation.setEmulatedMedia', {media: 'screen'});
  const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  assert.ok(!text.includes('REMOVE_THIS_PROMPT'));
  assert.ok(text.includes('Design for reading'));
  assert.ok(text.includes('minimal stack'));
  // PDF extraction can drop visual spaces; exact spacing is checked in the DOM.
  assert.match(text, /A\s*&\s*B/);
  assert.ok(text.includes('Literal &#x20; &amp;'), 'Printed code must preserve literal entities');
  assert.ok(!text.includes('minimal&#x20;stack'));
  assert.ok(text.includes('READER'));
  assert.ok(!text.includes('Export to PDF'));
  assert.ok(!text.includes('Headers and footers'));
  assert.ok(!text.includes('Select all'));
  assert.ok(!text.includes('Included'));
  assert.match(execFileSync('pdfimages', ['-list', pdf], {encoding: 'utf8'}), /image\s+720\s+200/);
  await evaluate('document.querySelector(".selection-actions input").click()');
  await until('document.querySelectorAll(".message").length === 4');
  await evaluate('document.querySelector(".download").click()');
  await until('printCalls === 2 && !document.querySelector(".download").disabled');
  const restored = await command('Page.printToPDF', {printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true});
  await writeFile(join(directory, 'restored.pdf'), Buffer.from(restored.data, 'base64'));
  assert.ok(execFileSync('pdftotext', [join(directory, 'restored.pdf'), '-'], {encoding: 'utf8'}).includes('REMOVE_THIS_PROMPT'));
  const setMargin = async value => {
    await evaluate(`(() => { const input = document.querySelector('#page-margin'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  };
  await setMargin('0');
  await until('Array.from(document.styleSheets).some(sheet => Array.from(sheet.cssRules).some(rule => rule.cssText === "@page { margin: 0mm; }"))');
  const zeroMargin = await command('Page.printToPDF', {printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true});
  const zeroPath = join(directory, 'zero-margin.pdf');
  await writeFile(zeroPath, Buffer.from(zeroMargin.data, 'base64'));
  const firstWord = path => {
    const bbox = execFileSync('pdftotext', ['-bbox', path, '-'], {encoding: 'utf8'});
    const match = bbox.match(/<word xMin="([\d.]+)" yMin="([\d.]+)"/);
    assert.ok(match, 'PDF must contain positioned text');
    return match.slice(1).map(Number);
  };
  const withMargin = firstWord(join(directory, 'restored.pdf'));
  const withoutMargin = firstWord(zeroPath);
  assert.ok(withMargin[0] - withoutMargin[0] > 65, 'Page margin must change the printed left edge');
  assert.ok(withMargin[1] - withoutMargin[1] > 65, 'Page margin must change the printed top edge');
  for (const invalid of ['-1', '51', 'abc']) {
    await setMargin(invalid);
    assert.equal(await evaluate('document.querySelector(".print-help style").textContent'), '@page { margin: 0mm; }');
  }
  await setMargin('18.5');
  await until('document.querySelector(".print-help style").textContent === "@page { margin: 18.5mm; }"');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await until('window.innerWidth === 390');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Preview must fit a narrow viewport');
  const mobile = await command('Page.captureScreenshot', {format: 'png'});
  await writeFile(join(directory, 'preview-mobile.png'), Buffer.from(mobile.data, 'base64'));
  console.log(`Browser preview checks passed. Screenshot: ${directory}/preview.png`);
} finally {
  ws?.close(); browser.kill(); server.close();
}
