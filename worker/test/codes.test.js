import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmail, readCodeEmail, sameCompany } from '../src/codes.js';

// A Greenhouse security-code email as Gmail forwards it: quoted-printable, with a soft line break mid-sentence.
const raw = [
  'From: Greenhouse <no-reply@us.greenhouse-mail.io>',
  'To: branskar01@gmail.com',
  'Subject: Security code for your application to SoFi',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Copy and paste this code into the security code field on your applicati=',
  'on: 4tQCgvQC',
  '',
  'After you enter the code, resubmit your application.',
  '--b1',
  'Content-Type: text/html; charset=UTF-8',
  '',
  '<p>Copy and paste this code into the security code field on your application: <b>4tQCgvQC</b></p>',
  '--b1--',
  '',
].join('\r\n');

test('a forwarded Greenhouse security-code email gives the company and the code', async () => {
  const found = readCodeEmail(await parseEmail(new TextEncoder().encode(raw)));
  assert.deepEqual(found, { company: 'SoFi', code: '4tQCgvQC' });
});

test('codes in HTML only, other sites\' wording, and emails that aren\'t codes', () => {
  assert.deepEqual(readCodeEmail({
    subject: 'Security code for your application to iSpot',
    html: '<td>Copy and paste this code into the security code field on your application:</td><td><strong>WpUMHMUV</strong></td>',
  }), { company: 'iSpot', code: 'WpUMHMUV' });
  assert.deepEqual(readCodeEmail({ subject: 'Confirm your email', text: 'Your verification code is 482913. It expires in 10 minutes.' }),
    { company: '', code: '482913' });
  assert.equal(readCodeEmail({ subject: 'Thanks for applying to Alpaca', text: 'We received your application.' }), null);
});

test('company names match loosely, but not across companies', () => {
  assert.ok(sameCompany('SoFi', 'SoFi'));
  assert.ok(sameCompany('iSpot.tv', 'iSpot'));
  assert.ok(sameCompany('BeyondTrust Corporation', 'BeyondTrust'));
  assert.ok(!sameCompany('Alpaca', 'SoFi'));
  assert.ok(!sameCompany('', 'SoFi'));
});
