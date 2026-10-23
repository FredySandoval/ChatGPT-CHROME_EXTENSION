import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { jsonToMarkdown, selectMarkdownMessages, validateMarkdownDownload } from '../lib/markdown-export.ts';
import { activeBranch } from '../lib/pdf-branch.ts';
import { withResearchReports } from '../lib/pdf-research.ts';
import { contentPartToText, normalizeChatGPTContent } from '../lib/chatgpt-content.ts';
const text = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('background.ts', text, ts.ScriptTarget.Latest, true);
let listenerSource;
const helpers = [];
const helperNames = new Set(['prepareCurrentChat', 'parseConversation', 'findAssetReferences', 'findAttachmentReferences', 'parseImageAssetPointer', 'getImageReferenceName', 'enrichChatsForJson', 'enrichMessage', 'applyContentReferences', 'flattenDirectiveBlocks', 'getReferenceReplacement', 'escapeRegExp']);
function visit(node) {
  if (ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text)) helpers.push(node.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'chrome.runtime.onMessage.addListener') listenerSource = node.getText(ast);
  else ts.forEachChild(node, visit);
}
visit(ast);
function worker(sourceUrl = 'https://example.com/c/chat-1', raw = undefined) {
  let listener;
  const downloads = [];
  const code = ts.transpileModule(helpers.join('\n') + '\n' + listenerSource, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {
    URL, Number, Error, selectMarkdownMessages, validateMarkdownDownload, activeBranch, withResearchReports, normalizeChatGPTContent, contentPartToText,
    debugLog: () => {}, debugWarn: () => {}, handleSingleRawUrlId: async () => [raw],
    chrome: { runtime: {getURL: p => 'chrome-extension://own' + p, onMessage: {addListener: l => {listener = l;}}}, tabs: {get: async () => ({url: sourceUrl})} },
    getErrorMessage: e => e.message,
    downloadMarkdownZip: async (...args) => downloads.push(args),
  });
  return { listener, downloads };
}
const page = {url: 'chrome-extension://own/markdown.html?tab=1'};
for (const url of ['https://chatgpt.com/c/chat-1', 'chrome-extension://own/popup.html', 'chrome-extension://other/markdown.html']) {
  const {listener} = worker(); let response;
  assert.equal(listener({message: 'prepareMarkdown', tabId: 1}, {url}, r => {response = r;}), false);
  assert.match(response.error, /extension page/);
}
async function request(payload) {
  const w = worker();
  const response = await new Promise(resolve => { assert.equal(w.listener(payload, page, resolve), true); });
  return { ...w, response };
}
for (const tabId of [0, -1, 1.5, '1']) assert.match((await request({message: 'prepareMarkdown', tabId})).response.error, /Invalid source tab/);
assert.match((await request({message: 'prepareMarkdown', tabId: 1})).response.error, /saved ChatGPT/);
assert.match((await request({message: 'downloadSelectedMarkdown', chat: {}, options: {}})).response.error, /Invalid/);
const chat = {conversation_id: 'chat-1', messages: [{role: 'user', content: ['Hello'], metadata: {}}], images: [{fileId: 'excluded', assetPointer: 'file-service://excluded'}]};
const options = {userLabel: '', assistantLabel: '', markdownExtension: '.md', mdxFrontmatter: '', includeImages: true};
// A fresh worker accepts the page's snapshot without prepare/cache state.
const result = await request({message: 'downloadSelectedMarkdown', chat, options});
assert.equal(result.response.success, true);
assert.equal(result.downloads[0][0][0].images.length, 0, 'Do not trust top-level inventories');
const rawMessage = (role, content, time) => ({author: {role}, content: {parts: [content], content_type: 'text'}, metadata: {}, create_time: time});
const raw = {conversation_id: 'chat-1', title: 'Branch test', current_node: 'answer', mapping: {
  root: {parent: null},
  prompt: {parent: 'root', message: rawMessage('user', '# Hello', 20)},
  obsolete: {parent: 'prompt', message: rawMessage('assistant', 'EXCLUDED BRANCH', 30)},
  answer: {parent: 'prompt', message: rawMessage('assistant', 'Answer', 10)},
}};
const preparedWorker = worker('https://chatgpt.com/c/chat-1/', raw);
const prepared = await new Promise(resolve => {
  assert.equal(preparedWorker.listener({message: 'prepareMarkdown', tabId: 1}, page, resolve), true);
});
assert.equal(prepared.error, undefined);
assert.equal(prepared.chat.messages.length, 2);
assert.equal(prepared.chat.messages[0].role, 'user', 'Preserve branch order, not timestamps');
assert.equal(prepared.chat.messages[1].rendered_markdown, 'Answer');
assert.equal(prepared.chat.conversation_id, 'chat-1');
// Voice-mode objects must become readable text before either selector serializes them.
const voice = (role, text, direction) => ({author: {role}, content: {content_type: 'multimodal_text', parts: [{content_type: 'audio_transcription', text, direction, decoding_id: null}]}, metadata: {voice_mode_message: true}});
const voiceRaw = {conversation_id: 'voice-chat-1', title: 'Voice transcript', current_node: 'answer', mapping: {
  root: {parent: null},
  prompt: {parent: 'root', message: voice('user', ' How do I attach to tmux?', 'in')},
  answer: {parent: 'prompt', message: voice('assistant', ' Use `tmux new -A -s Py`.', 'out')},
}};
const voiceBefore = JSON.stringify(voiceRaw);
const voiceWorker = worker('https://chatgpt.com/c/voice-chat-1', voiceRaw);
const voiceResponse = await new Promise(resolve => voiceWorker.listener({message: 'prepareMarkdown', tabId: 1}, page, resolve));
assert.equal(voiceResponse.error, undefined);
assert.equal(voiceResponse.chat.messages[0].content[0], ' How do I attach to tmux?');
assert.equal(voiceResponse.chat.messages[1].rendered_markdown, 'Use `tmux new -A -s Py`.');
assert.equal(JSON.stringify(voiceRaw), voiceBefore, 'Raw conversation must not be mutated');
assert.equal(jsonToMarkdown(voiceResponse.chat), 'USER\n\nHow do I attach to tmux?\n\n---\n\nASSISTANT\n\nUse `tmux new -A -s Py`.\n\n---\n\n');
const pdfResponse = await new Promise(resolve => voiceWorker.listener({message: 'preparePdf', tabId: 1}, {url: 'chrome-extension://own/pdf.html'}, resolve));
assert.equal(pdfResponse.chat.messages[1].markdown, 'Use `tmux new -A -s Py`.');
console.log('Markdown messaging checks passed.');
