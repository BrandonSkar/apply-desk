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

// The smallest "N years of experience" a posting asks for, or null if it doesn't say. Using the smallest means a
// job is only skipped when every experience requirement in it is above the limit ("3+ required, 6+ preferred"
// stays; "8+ years" goes). Mentions that aren't about experience ("18 years of age") are ignored.
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };
const EXPERIENCE = /experience|engineering|developing|development|programming|building|industry|professional|working|hands-on|coding/i;

export function requiredYears(text) {
  if (!text) return null;
  const t = String(text).replace(/<[^>]+>/g, '. ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
  const n = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)';
  const re = new RegExp(`\\b${n}\\s*(?:\\+|plus)?\\s*(?:(?:-|–|to)\\s*${n}\\s*)?\\+?\\s*(?:or more\\s*)?(?:years?|yrs?)\\b([^.;•]{0,90})`, 'gi');
  let min = null;
  for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, m.index - 50), m.index);
    if (!EXPERIENCE.test(m[3] || '') && !/experience[^.;•]{0,40}$/i.test(before)) continue;
    if (/^\s*(of age|old)\b/i.test(m[3] || '')) continue;
    const years = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1].toLowerCase()];
    if (!years || years > 20) continue;
    if (min === null || years < min) min = years;
  }
  return min;
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
    if (j.min_years != null && settings.maxYearsRequired && j.min_years > settings.maxYearsRequired) continue;
    const where = m.place(j.location, { remote: j.remote, country: j.country });
    if (!where) continue;
    kept.push({ ...j, remote: where === 'remote' ? 1 : 0 });
  }
  return kept;
}
