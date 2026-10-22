import assert from 'node:assert/strict';
import { withResearchReports } from '../lib/pdf-research.ts';
import { activeBranch } from '../lib/pdf-branch.ts';

const report = { id: 'report', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['# Research\n\nFull report with citation.'] }, metadata: { content_references: [{ alt: 'Source' }] } };
const widget = state => ({ message: { author: { role: 'tool' }, metadata: { chatgpt_sdk: { widget_state: typeof state === 'string' ? state : JSON.stringify(state) } } } });
const source = { widget: widget({ plan: { secret: 'Do not export' }, report_message: report }), final: { message: { author: { role: 'assistant' }, content: { parts: ['Research has started.'] } } } };
const before = JSON.stringify(source);
const expanded = withResearchReports(source);
assert.deepEqual(Object.keys(expanded), ['widget', 'widget:research-report', 'final']);
assert.deepEqual(expanded['widget:research-report'].message, report);
assert.equal(JSON.stringify(source), before, 'Must not mutate saved data');
assert.equal(Object.keys(withResearchReports({ ...source, repeated: source.widget })).length, 4);
assert.equal(Object.keys(withResearchReports({ ...source, normal: { message: report } })).length, 3);
assert.equal(Object.keys(withResearchReports({ ...source, normal: { message: { ...report, id: 'different' } } })).length, 3);
for (const state of ['broken JSON', null, {}, { report_message: {} }, { report_message: { ...report, author: { role: 'tool' } } }, { report_message: { ...report, content: { content_type: 'text', parts: [42] } } }]) {
  assert.equal(Object.keys(withResearchReports({ node: widget(state) })).length, 1);
}
const branches = { root: { parent: null }, widget: { ...source.widget, parent: 'root' }, current: { parent: 'root' } };
assert.equal(Object.keys(withResearchReports(activeBranch(branches, 'current'))).length, 2, 'Must not leak inactive reports');
console.log('PDF research checks passed.');
