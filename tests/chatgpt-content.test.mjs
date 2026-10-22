import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeChatGPTContent } from '../lib/chatgpt-content.ts';

const source = { title: 'Example source', url: 'https://example.com/', ref_id: { turn_index: 123, ref_type: 'view', ref_index: 0 } };
const metadata = { search_result_groups: [{ entries: [source] }], model_dil_v2: { fallbackMarkdown: 'A: urlExamplehttps://example.com/\n\nSource: citeturn123view0\n\n**Development priorities**  selected\n\n[Copy selected priorities]' } };
const raw = '{@body const features = [{name:"Citations",priority:"High"},{name:"Copy",priority:"Medium"}]}\n{#each features as f,i}\n<box>...</box>';
const before = JSON.stringify(metadata);
const result = normalizeChatGPTContent(raw, metadata);
assert.ok(result.includes('[Example](<https://example.com/>)'));
assert.ok(result.includes('[Example source](<https://example.com/>)'));
assert.ok(result.includes('| Citations | High |'));
assert.ok(result.includes('| Copy | Medium |'));
assert.ok(!result.includes('<box>'));
assert.equal(JSON.stringify(metadata), before);
assert.match(normalizeChatGPTContent('<Cite refs={["missing"]}/>'), /Source unavailable: missing/);
assert.match(normalizeChatGPTContent('<Cite refs={["turn123view0"]}/>', metadata), /Example source/);
const code = '`<Cite refs={["missing"]}/>`\n\n```html\n<Cite refs={["missing"]}/>\n```';
assert.equal(normalizeChatGPTContent(code), code, 'Code examples must remain literal');
assert.match(normalizeChatGPTContent(raw.replace('"High"', 'runCode()'), metadata), /dynamic content may be unavailable/);
assert.ok(!normalizeChatGPTContent('', { model_dil_v2: { fallbackMarkdown: 'urlUnsafejavascript:alert(1)' } }).includes('javascript:'));

// Optional local regression against an export; private conversation data is not committed.
if (process.argv[2]) {
  const conversations = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const message = conversations[0].mapping['7ceddd92-10fc-439b-b68d-e592f90e5962'].message;
  const normalized = normalizeChatGPTContent(message.content.parts.join('\n\n'), message.metadata);
  assert.ok(normalized.includes('| Deep Research and source citation export | High |'));
  assert.ok(normalized.includes('| Keyboard shortcuts and saved settings | Low |'));
  assert.ok(normalized.includes('](<https://chromewebstore.google.com/'));
  for (const marker of ['<Cite', '<Link', '{@body', '<box', 'cite', 'Source unavailable']) assert.ok(!normalized.includes(marker), marker);
}
console.log('ChatGPT content checks passed.');
