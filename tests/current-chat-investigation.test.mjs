// Source-executing regression tests plus unchanged branch characterization.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function nodeSource(path, predicate) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (predicate(node, source)) { assert.equal(found, undefined); found = node.getText(source); return; }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found);
  return found;
}
const bg = '../entrypoints/background.ts';
const popup = '../entrypoints/popup/App.tsx';
const fn = (name, path = bg) => nodeSource(path, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
function run(source, globals = {}) {
  return vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, globals);
}
function selection(items) {
  return run(`${fn('parseProjectInfoFromUrl')}\n${fn('getConversationIdFromTabs')}\ngetConversationIdFromTabs`, {
    URL, loadToken: async () => 'synthetic', getConversationIds: async () => ({ items }), debugLog() {},
  });
}
test('home never falls back to another chat; unavailable tab is controlled', async () => {
  await assert.rejects(selection([{ id: 'unrelated' }])([{ url: 'https://chatgpt.com/' }]), /SOURCE_NOT_SAVED/);
  await assert.rejects(selection([])([{ url: 'https://chatgpt.com/' }]), /SOURCE_NOT_SAVED/);
  await assert.rejects(selection([])([]), /SOURCE_TAB_UNAVAILABLE/);
});
test('selection accepts saved project paths and rejects foreign origins and shares', async () => {
  for (const url of ['https://chatgpt.com/share/aaa-bbb-ccc', 'https://example.org/aaa-bbb-ccc']) {
    await assert.rejects(selection([])([{ url }]), /SOURCE_/);
  }
  for (const url of ['https://chatgpt.com/c/aaa-bbb-ccc', 'https://chatgpt.com/g/g-p-test/c/aaa-bbb-ccc']) {
    assert.equal((await selection([])([{ url }])).id, 'aaa-bbb-ccc');
  }
});
test('missing payload becomes empty parsed conversation; all branches are merged', () => {
  const parse = run(`${fn('parseConversation')}\nparseConversation`, {
    debugLog() {}, findAssetReferences: () => ({ images: [], unsupported: [] }),
    findAttachmentReferences: () => [], contentPartToText: x => x,
  });
  assert.equal(parse(null).messages.length, 0);
  const message = text => ({ author: { role: 'user' }, content: { parts: [text] } });
  const result = parse({ current_node: 'a', mapping: { a: { message: message('selected') }, b: { message: message('other branch') } } });
  assert.equal(result.messages.length, 2);
});
test('single failure produces progress error then response error', async () => {
  let listener;
  const events = [];
  const source = nodeSource(bg, (n, s) => ts.isCallExpression(n) && n.expression.getText(s) === 'chrome.runtime.onMessage.addListener');
  run(source, {
    chrome: { runtime: { onMessage: { addListener: cb => { listener = cb; } } } },
    handleSingleUrlId: async (_tabs, setStage) => { setStage('FETCH_CONVERSATION'); throw new Error('synthetic fetch failure'); },
    DownloadStageError: class extends Error {},
    debugError() {}, getErrorMessage: e => e.message,
    setProgress: (text, completed, status, _target, failureStage) => events.push({ text, completed, status, failureStage }),
  });
  assert.equal(listener({ message: 'backUpSingleChat', tabs: [], downloadType: 'markdown' }, {}, response => events.push(response)), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 2);
  assert.equal(events[0].status, 'error');
  assert.equal(events[0].completed, 0);
  assert.equal(events[1].error, 'synthetic fetch failure');
  assert.equal(events[0].failureStage, 'FETCH_CONVERSATION');
  assert.equal(events[1].failureStage, 'FETCH_CONVERSATION');
});
test('single chat stages distinguish selection, fetching, conversion and download', async () => {
  for (const expected of ['SOURCE_SELECTION', 'FETCH_CONVERSATION', 'CONVERT', 'DOWNLOAD']) {
    let listener;
    const events = [];
    class DownloadStageError extends Error {}
    const source = nodeSource(bg, (n, s) => ts.isCallExpression(n) && n.expression.getText(s) === 'chrome.runtime.onMessage.addListener');
    run(source, {
      chrome: { runtime: { onMessage: { addListener: cb => { listener = cb; } } } },
      DownloadStageError,
      handleSingleUrlId: async (_tabs, setStage) => {
        if (expected === 'SOURCE_SELECTION') throw new Error('selection');
        setStage('FETCH_CONVERSATION');
        if (expected === 'FETCH_CONVERSATION') throw new Error('fetch');
        setStage('CONVERT');
        if (expected === 'CONVERT') throw new Error('conversion');
        return [];
      },
      downloadMarkdownZip: async () => { throw new DownloadStageError('download'); },
      debugError() {}, getErrorMessage: e => e.message,
      setProgress: (_text, _completed, _status, _target, failureStage) => events.push(failureStage),
    });
    listener({ message: 'backUpSingleChat', tabs: [], downloadType: 'markdown' }, {}, response => events.push(response.failureStage));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, [expected, expected]);
  }
});
test('progress port exception cannot escape', () => {
  const send = run(`${fn('setProgress')}\nsetProgress`, {
    getProgressMessage: () => ({}), ports: new Set([{ postMessage() { throw new Error('disconnected'); } }]), progressState: {},
  });
  assert.doesNotThrow(() => send('failure', 0, 'error'));
});
test('both download URL paths reject interruption and clean up', async () => {
  for (const objectUrl of [false, true]) {
    let changed;
    let revoked = false;
    const save = run(`${fn('saveAsImpl')}\nsaveAsImpl`, {
      Blob, setTimeout, clearTimeout, URL: objectUrl ? { createObjectURL: () => 'blob:synthetic', revokeObjectURL: () => { revoked = true; } } : {},
      blobToDataUrl: async () => 'data:text/plain;base64,eA==', debugLog() {}, debugWarn() {},
      chrome: { runtime: {}, downloads: { download: (_options, cb) => cb(7), search: (_query, cb) => cb([{ state: 'in_progress' }]), onChanged: { addListener: cb => { changed = cb; }, removeListener() {} } } },
    });
    const promise = save('x');
    await new Promise(resolve => setImmediate(resolve));
    changed({ id: 7, state: { current: 'interrupted' } });
    await assert.rejects(promise, /DOWNLOAD_INTERRUPTED/);
    assert.equal(revoked, objectUrl);
  }
});
test('download reconciles completion before callback for both URL paths', async () => {
  for (const objectUrl of [false, true]) {
    let removed = false;
    const save = run(`${fn('saveAsImpl')}\nsaveAsImpl`, {
      Blob, setTimeout, clearTimeout,
      URL: objectUrl ? { createObjectURL: () => 'blob:test', revokeObjectURL() {} } : {},
      blobToDataUrl: async () => 'data:text/plain;base64,eA==', debugWarn() {},
      chrome: { runtime: {}, downloads: {
        download: (_options, cb) => cb(7),
        search: (_query, cb) => cb([{ state: 'complete' }]),
        onChanged: { addListener() {}, removeListener() { removed = true; } },
      } },
    });
    assert.equal(await save('x'), 7);
    assert.equal(removed, true);
  }
});
test('conversation fetch rejects invalid envelopes before normalization', async () => {
  for (const payload of [null, {}, { mapping: [] }, { mapping: {} }]) {
    const fetchChat = run(`${fn('fetchConversation')}\nfetchConversation`, {
      fetch: async () => ({ ok: true, json: async () => payload }),
    });
    await assert.rejects(fetchChat('synthetic', 'synthetic'), /CONVERSATION_INVALID/);
  }
});
test('optional image fetch rejection is downgraded to a warning', async () => {
  const warnings = [];
  const add = run(`${fn('addChatImagesToZip')}\naddChatImagesToZip`, {
    getImageFilename: () => 'image.png', downloadFileBlob: async () => { throw new Error('synthetic 403'); },
    getErrorMessage: e => e.message, debugWarn() {}, logAssetProgress: (...args) => warnings.push(args),
  });
  await add({}, { conversation_id: 'synthetic', images: [{ fileId: 'file-test' }] });
  assert.equal(warnings[0][1], 'warning');
});
test('successful session response without token is rejected', async () => {
  const load = run(`${fn('loadToken')}\nloadToken`, {
    accessTokenMemoryCache: null, fetch: async () => ({ ok: true, json: async () => ({}) }),
  });
  await assert.rejects(load(), /AUTHORIZATION_FAILED/);
});
test('undefined response is reported as an error', () => {
  const events = [];
  const show = run(`${fn('showResponseStatus', popup)}\nshowResponseStatus`, {
    chrome: { runtime: {} }, updateProgress: (...args) => events.push(args), resetRunningStates() {},
  });
  show(undefined);
  assert.equal(events[0][1], 'error');
});
