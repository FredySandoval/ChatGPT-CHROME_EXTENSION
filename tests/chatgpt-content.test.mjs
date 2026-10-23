import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanMarkdownSource, contentPartToText, normalizeChatGPTContent } from '../lib/chatgpt-content.ts';

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

const transcription = { content_type: 'audio_transcription', text: ' Use `tmux new -A -s Py`.\n\nKeep **Markdown** and Unicode: 世界', direction: 'out', decoding_id: null };
assert.equal(contentPartToText(transcription), transcription.text);
assert.equal(contentPartToText({ ...transcription, direction: 'in' }), transcription.text);
assert.equal(contentPartToText({ ...transcription, text: '' }), '');
const literalJson = JSON.stringify(transcription);
assert.equal(contentPartToText(literalJson), literalJson, 'Do not parse JSON-looking user text');
const unknownPart = { content_type: 'unknown', text: 'Keep metadata', value: 42 };
assert.equal(contentPartToText(unknownPart), JSON.stringify(unknownPart));
const malformed = { content_type: 'audio_transcription', text: null };
assert.equal(contentPartToText(malformed), JSON.stringify(malformed));
assert.equal(contentPartToText('```json\n' + literalJson + '\n```'), '```json\n' + literalJson + '\n```');

const noisySource = 'Which course?&#x20;\n\nAdditional Courses\\\n\\\nSecurity Course\\\nFree';
assert.equal(cleanMarkdownSource(noisySource), 'Which course? \n\nAdditional Courses  \n\nSecurity Course  \nFree');
assert.equal(cleanMarkdownSource('**Beyond\\!** Choose\\: a course\\.'), '**Beyond!** Choose: a course.');
const preserved = [
  '`Beyond\\! &#x20;`',
  '```md\nBeyond\\! &#x20;\nline\\\n```',
  '    Beyond\\! &#x20;\n',
  '[Label](https://example.com/a\\!b)',
  '![Image](https://example.com/a\\!b)',
  '\\![not an image](https://example.com)',
  '1\\. Not a list',
  '> 1\\. Not a list',
  '<span title="&#x20;">HTML</span>',
  String.raw`Literal \\! and \&#x20;`,
  '&amp;#x20; &lt;script&gt;',
  '#&#x20;not a heading',
  '-&#32;not a list',
];
for (const source of preserved) assert.equal(cleanMarkdownSource(source), source, source);
assert.equal(cleanMarkdownSource(cleanMarkdownSource(noisySource)), cleanMarkdownSource(noisySource));
const fallbackMetadata = { model_dil_v2: { fallbackMarkdown: '**Beyond\\!**\n\nChoose\\: a course\\.' } };
assert.equal(normalizeChatGPTContent('ignored', fallbackMetadata), '**Beyond!**\n\nChoose: a course.');
assert.equal(fallbackMetadata.model_dil_v2.fallbackMarkdown, '**Beyond\\!**\n\nChoose\\: a course\\.');

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
