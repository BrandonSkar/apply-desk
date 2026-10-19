// Two ways in: the page uses a password login (signed cookie), the PC helper and MCP server use a token.
// Secrets (set with `wrangler secret put`): APP_PASSWORD, SESSION_SECRET, RUNNER_TOKEN.

const enc = new TextEncoder();
const COOKIE = 'ad_session';
const SESSION_DAYS = 30;

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameString(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function passwordMatches(env, given) {
  if (!env.APP_PASSWORD || !env.SESSION_SECRET) return false;
  // Compare MACs, not the raw strings, so the comparison takes the same time whatever the length.
  return sameString(await hmac(env.SESSION_SECRET, given || ''), await hmac(env.SESSION_SECRET, env.APP_PASSWORD));
}

export async function sessionCookie(env) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const value = `${exp}.${await hmac(env.SESSION_SECRET, `session:${exp}`)}`;
  return `${COOKIE}=${value}; Path=/jobs; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookie = `${COOKIE}=; Path=/jobs; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export async function hasSession(env, request) {
  if (!env.SESSION_SECRET) return false;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.get('cookie') || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sameString(sig, await hmac(env.SESSION_SECRET, `session:${exp}`));
}

export function hasToken(env, request) {
  const h = request.headers.get('authorization') || '';
  return !!env.RUNNER_TOKEN && sameString(h, `Bearer ${env.RUNNER_TOKEN}`);
}
