import assert from 'node:assert/strict';
import { activeBranch } from '../lib/pdf-branch.ts';
import { messageLabel, selectMessages, safeExportLink } from '../lib/export-document.ts';

assert.deepEqual(Object.keys(activeBranch({ root: { parent: null }, prompt: { parent: 'root' }, old: { parent: 'prompt' }, current: { parent: 'prompt' } }, 'current')), ['root', 'prompt', 'current']);
assert.throws(() => activeBranch({ a: { parent: 'b' }, b: { parent: 'a' } }, 'a'));
assert.throws(() => activeBranch({}, undefined));
assert.throws(() => activeBranch({ a: { parent: 'missing' } }, 'a'));
assert.equal(messageLabel('user', {userLabel: ''}), '');
assert.equal(messageLabel('assistant', {assistantLabel: 'Helper'}), 'Helper');
assert.equal(safeExportLink('javascript:alert(1)'), undefined);
assert.equal(safeExportLink('https://example.com'), 'https://example.com');
const chat = {messages: [{role: 'user'}, {role: 'assistant'}]};
assert.deepEqual(selectMessages(chat, new Set([1])).messages, [chat.messages[1]]);
assert.equal(chat.messages.length, 2);
console.log('Export checks passed.');
