// Decides which postings belong in the queue: right kind of title, right place, recent enough.

const NON_US = /\b(canada|uk|united kingdom|england|london|ireland|dublin|europe|emea|germany|berlin|france|paris|spain|poland|portugal|netherlands|amsterdam|india|bangalore|bengaluru|hyderabad|brazil|mexico|colombia|argentina|latam|apac|australia|japan|tokyo|singapore|israel|bulgaria|romania|ukraine|china|korea|philippines|costa rica|switzerland|sweden|denmark|czech|serbia|estonia|lithuania|turkey|egypt|nigeria|kenya|south africa|new zealand|vietnam|indonesia|malaysia|taiwan|hong kong)\b/i;
const US_CASED = /\b(US|USA|U\.S\.A?\.?)\b/;
const US_WORDS = /united states|america\b|americas|north america/i;
const REMOTE = /\b(remote|anywhere|distributed|virtual)\b/i;
const DC = /\bD\.?C\.?\b|district of columbia/i;

export function makeMatcher(settings) {
  const any = (list) => new RegExp(list.join('|'), 'i');
  const include = any(settings.titleInclude);
  const level = new RegExp(`\\b(${settings.levelExclude.join('|')})\\b`, 'i');
  const hard = any(settings.hardExclude);
  const area = new RegExp(`\\b(${settings.areas.join('|')})\\b`, 'i');

  return {
    title(title) {
      if (!title || hard.test(title)) return false;
      // "Software Engineer II and/or Senior Software Engineer" -> check each role named.
      const parts = title.split(/\s*(?:\/|\band\/or\b|\bor\b|\band\b|&)\s*/i);
      return parts.some((p) => include.test(p) && !level.test(p));
    },

    // Returns 'area', 'remote', or null.
    place(location, { remote = false, country = '' } = {}) {
      const loc = location || '';
      if (area.test(loc) && !(DC.test(loc) && !/seattle|bellevue|redmond/i.test(loc))) return 'area';
      if (!settings.remoteUS) return null;
      if (!(remote || REMOTE.test(loc))) return null;
      if (country) return country.toUpperCase() === 'US' ? 'remote' : null;
      const saysUS = US_CASED.test(loc) || US_WORDS.test(loc);
      if (NON_US.test(loc) && !saysUS) return null;
      return 'remote';
    },
  };
}

export function isRecent(postedAt, maxAgeDays, now = Date.now()) {
  if (!postedAt) return true;
  const t = Date.parse(postedAt);
  return Number.isNaN(t) || now - t <= maxAgeDays * 864e5;
}

// Keep the jobs that pass. Each job: { title, location, remote, country, posted_at, ... }
export function filterJobs(jobs, settings, now = Date.now()) {
  const m = makeMatcher(settings);
  const kept = [];
  for (const j of jobs) {
    if (!m.title(j.title)) continue;
    if (!isRecent(j.posted_at, settings.maxAgeDays, now)) continue;
    const where = m.place(j.location, { remote: j.remote, country: j.country });
    if (!where) continue;
    kept.push({ ...j, remote: where === 'remote' ? 1 : 0 });
  }
  return kept;
}
