import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import pdfMake from 'pdfmake/build/pdfmake.js';
import fonts from 'pdfmake/build/vfs_fonts.js';
import { activeBranch } from '../lib/pdf-branch.ts';
import { buildPdfDocument, markdownBlocks } from '../lib/pdf-document.ts';

assert.deepEqual(Object.keys(activeBranch({ root: { parent: null }, prompt: { parent: 'root' }, old: { parent: 'prompt' }, current: { parent: 'prompt' } }, 'current')), ['root', 'prompt', 'current']);
assert.throws(() => activeBranch({ a: { parent: 'b' }, b: { parent: 'a' } }, 'a'));
assert.throws(() => activeBranch({}, undefined));
assert.throws(() => activeBranch({ a: { parent: 'missing' } }, 'a'));
const linked = markdownBlocks('[unsafe](javascript:alert) and [source](https://example.com)');
assert.equal(linked[0].text[0].link, undefined);
assert.equal(linked[0].text.at(-1).link, 'https://example.com');
const table = markdownBlocks('|Name|Value|\n|---|---|\n|A|1|')[0];
assert.equal(table.table.headerRows, 1);
assert.equal(table.table.body.length, 2);

pdfMake.addVirtualFileSystem({ ...fonts, 'Mono.ttf': (await readFile(new URL('../public/pdf-fonts/LiberationMono-Regular.ttf', import.meta.url))).toString('base64') });
pdfMake.addFonts({ Mono: { normal: 'Mono.ttf', bold: 'Mono.ttf', italics: 'Mono.ttf', bolditalics: 'Mono.ttf' } });
// A real PNG tests embedding without external URLs or network requests.
const image = 'data:image/png;base64,' + (await readFile(new URL('./fixtures/export-image.png', import.meta.url))).toString('base64');
const chat = {
  title: 'A practical guide to better documents',
  messages: [
    { role: 'user', markdown: 'How can we create a readable document with **images**, code, and tables?', images: [], attachments: [] },
    { role: 'assistant', markdown: '# A document built for reading\n\nUse generous margins, clear headings, and a consistent rhythm. Español: información, análisis, conversación.\n\n## Implementation\n\n```js\nfunction exportChat(chat) {\n  return createDocument(chat);\n}\n```\n\n- Keep the original wording.\n- Preserve [source links](https://example.com).\n- Save equations as source: $$E = mc^2$$.\n\n| Feature | Output |\n| --- | --- |\n| Text | Selectable |\n| Images | Embedded |\n| Code | Monospaced |\n\n> A document should be easy to read on paper.', images: [{ name: 'Embedded image', data: image }, { name: 'missing-example.png' }], attachments: ['research.pdf'] },
    { role: 'user', markdown: 'Show a longer table and answer.', images: [], attachments: [] },
    { role: 'assistant', markdown: '| Item | Description |\n|---|---|\n' + Array.from({ length: 65 }, (_, i) => `| ${i + 1} | Example row for pagination and repeated headers |`).join('\n') + '\n\n' + 'A readable paragraph keeps the original content intact while allowing it to flow across pages. '.repeat(65), images: [], attachments: [] },
  ],
};
const definition = buildPdfDocument(chat);
const documentText = JSON.stringify(definition);
assert.ok(documentText.includes('USER'));
assert.ok(documentText.includes('ASSISTANT'));
for (const addedText of ['CONVERSATION EXPORT', 'QUESTION', 'ANSWER', 'ChatGPT Backup', 'Image unavailable:', '(not embedded)']) {
  assert.ok(!documentText.includes(addedText), `Unexpected export text: ${addedText}`);
}
assert.equal(definition.footer, undefined);
assert.equal(definition.info.creator.trim(), '');
assert.equal(definition.info.producer.trim(), '');
const custom = buildPdfDocument(chat, { userLabel: 'Fredy', assistantLabel: 'Helper' });
assert.deepEqual(custom.content.filter(node => node.headlineLevel === 1 && node.fontSize === 9).map(node => node.text), ['Fredy', 'Helper', 'Fredy', 'Helper']);
const unlabeled = buildPdfDocument({ messages: chat.messages }, { userLabel: '', assistantLabel: '' });
assert.equal(unlabeled.content.filter(node => node.headlineLevel === 1 && node.fontSize === 9).length, 0);
assert.ok(!JSON.stringify(unlabeled).includes('ChatGPT conversation'));
const buffer = await pdfMake.createPdf(definition).getBuffer();
assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
assert.ok(buffer.length > 10000);
if (process.argv[2]) await writeFile(process.argv[2], buffer);
console.log(`PDF export checks passed (${buffer.length} bytes).`);
