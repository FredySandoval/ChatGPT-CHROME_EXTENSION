import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual source nodes, not copied implementations. Isolating them
// avoids starting the background worker or mounting React during these tests.
function sourceNode(path, predicate) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (predicate(node, source)) {
      assert.equal(found, undefined, 'Expected one matching source node');
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Source node not found in ${path}`);
  return found.getText(source);
}

function execute(source, globals) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  });
  return vm.runInNewContext(outputText, globals);
}

const listenerSource = sourceNode('../entrypoints/background.ts', (node, source) =>
  ts.isCallExpression(node) && node.expression.getText(source) === 'chrome.runtime.onMessage.addListener');
const helperSource = sourceNode('../entrypoints/popup/App.tsx', node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'sendMessage');

function background() {
  let listener;
  const writes = [];
  execute(listenerSource, {
    chrome: {
      runtime: { onMessage: { addListener: callback => { listener = callback; } } },
      storage: { local: { set: async value => { writes.push(value); } } },
    },
    activeBackupController: null,
  });
  return { listener, writes };
}

// Regression tests for the messaging response and error contracts.
test('getColorScheme responds after saving the color scheme', async () => {
  const { listener, writes } = background();
  const responses = [];
  assert.equal(listener({ message: 'getColorScheme', colorScheme: 'dark' }, {}, value => responses.push(value)), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].colorScheme, 'dark');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].success, true);
});

test('unknown messages do not promise an asynchronous response', async () => {
  const { listener } = background();
  const responses = [];
  assert.equal(listener({ message: '__unknown_test_message__' }, {}, value => responses.push(value)), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(responses.length, 0);
});

test('control: stopBackup still sends its synchronous response', () => {
  const { listener } = background();
  const responses = [];
  listener({ message: 'stopBackup' }, {}, value => responses.push(value));
  assert.equal(responses.length, 1);
  assert.equal(responses[0].message, 'stopBackup idle');
});

test('popup rejects with the callback-scoped runtime error', async () => {
  let reads = 0;
  let inCallback = false;
  const runtime = {
    get lastError() {
      assert.equal(inCallback, true, 'lastError is only available during the callback');
      reads++;
      return { message: 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received.' };
    },
    sendMessage(_message, callback) {
      queueMicrotask(() => {
        inCallback = true;
        try { callback(undefined); } finally { inCallback = false; }
      });
    },
  };
  const sendMessage = execute(`${helperSource}\nsendMessage;`, { chrome: { runtime } });
  await assert.rejects(sendMessage({ message: 'backUpAllAsJSON' }), {
    message: 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received.',
  });
  assert.equal(reads, 1, 'Transport error must be inspected inside the callback');
});

test('control: popup preserves successful responses', async () => {
  const response = { message: 'backUpAllAsJSON done' };
  const sendMessage = execute(`${helperSource}\nsendMessage;`, {
    chrome: { runtime: { sendMessage: (_message, callback) => callback(response) } },
  });
  assert.equal(await sendMessage({ message: 'backUpAllAsJSON' }), response);
});
