// Security codes that job sites email you ("Security code for your application to SoFi"). A Gmail filter forwards
// only those emails to codes@brandonskar.com, which Cloudflare hands to this Worker; the helper on your PC picks the
// code up for the application waiting on it. Nothing else in your inbox comes here.
import PostalMime from 'postal-mime';
import { companyKey } from './autofill.js';

// Greenhouse: "Copy and paste this code into the security code field on your application: 4tQCgvQC".
const GREENHOUSE_SUBJECT = /security code for your application to (.+?)\s*$/i;
const GREENHOUSE_CODE = /security code field on your application:\s*([A-Za-z0-9]{6,12})\b/i;
// Other sites word it loosely: "Your verification code is 123456".
const ANY_CODE = /(?:verification|security|one-time|confirmation) code(?: is|:)\s*([A-Za-z0-9]{4,12})\b/i;

// { company, code } from a parsed email ({ subject, text, html }), or null when it isn't a code email.
export function readCodeEmail(mail) {
  const subject = String(mail.subject || '');
  const body = String(mail.text || '') || String(mail.html || '').replace(/<[^>]+>/g, ' ');
  const flat = body.replace(/\s+/g, ' ');
  const company = (GREENHOUSE_SUBJECT.exec(subject) || [])[1] || '';
  const code = (GREENHOUSE_CODE.exec(flat) || ANY_CODE.exec(flat) || [])[1];
  return code ? { company: company.trim(), code } : null;
}

// "iSpot" and "iSpot.tv", "SoFi" and "SoFi Technologies": the same company.
export function sameCompany(a, b) {
  const [x, y] = [companyKey(a), companyKey(b)];
  return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

export async function parseEmail(raw) {
  return PostalMime.parse(raw);
}
