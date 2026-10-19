import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// config.local.json holds your site URL, the helper token and your resume path. It is never committed.
export function loadConfig() {
  const file = path.join(ROOT, 'config.local.json');
  if (!existsSync(file)) {
    throw new Error(`Missing ${file}. Copy config.example.json to config.local.json and fill it in.`);
  }
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of ['siteUrl', 'token']) {
    if (!cfg[key]) throw new Error(`config.local.json is missing "${key}".`);
  }
  cfg.siteUrl = cfg.siteUrl.replace(/\/+$/, '');
  cfg.browser ||= 'chrome';
  cfg.profileDir = path.resolve(ROOT, cfg.profileDir || '.browser-profile');
  cfg.shotsDir = path.resolve(ROOT, cfg.shotsDir || 'screenshots');
  return cfg;
}

export function makeApi(cfg) {
  return async function api(route, { method = 'GET', body } = {}) {
    const res = await fetch(`${cfg.siteUrl}/api${route}`, {
      method,
      headers: { authorization: `Bearer ${cfg.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The site answered ${res.status}`);
    return data;
  };
}
