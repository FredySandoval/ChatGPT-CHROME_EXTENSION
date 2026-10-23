import assert from 'node:assert/strict';
import { classifyReportError, emailDraft } from '../lib/feedback.ts';

assert.equal(classifyReportError('A listener indicated an asynchronous response; message channel closed'), 'MESSAGE_CHANNEL_CLOSED');
assert.equal(classifyReportError('Could not establish connection'), 'CONNECTION_UNAVAILABLE');
assert.equal(classifyReportError('private conversation text https://chatgpt.com/c/secret token=secret'), 'OPERATION_FAILED');
const body = 'Version: 0.1.5\nProgress: 1/2 & test + unicode ✓';
const mail = new URL(emailDraft('Bug & test', body));
assert.equal(mail.protocol, 'mailto:');
assert.equal(mail.pathname, 'support+bugs@fredy.dev');
assert.equal(mail.searchParams.get('body'), body);
assert.equal(mail.searchParams.get('subject'), 'Bug & test');
const feedback = new URL(emailDraft('Feedback', body, 'feedback'));
assert.equal(feedback.protocol, 'mailto:');
assert.equal(feedback.pathname, 'support+feedback@fredy.dev');
assert.equal(feedback.searchParams.get('body'), body);
console.log('Feedback tests passed');
