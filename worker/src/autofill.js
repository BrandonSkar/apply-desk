// Answers what it can from your profile and your past answers, so the page only asks what's new.
// Every question lands in one bucket:
//   auto      - answered from your profile with confidence (collapsed on the page)
//   suggested - prefilled from a past answer or a sensible default, shown so you can check it
//   open      - required and unanswered: you need to answer it
//   optional  - not required and unanswered

const DECLINE = /decline|don.?t wish|do not wish|prefer not|not to (answer|say|disclose|self)|choose not|rather not|not wish to/i;
const YES = /^\s*yes\b/i;
const NO = /^\s*no\b/i;

// Text-message opt-ins ("I agree to receive SMS updates"). Checked before the consent rule, which would tick them.
export const SMS = /\bsms\b|text messag|\btexts?\b.{0,40}(updates|alerts|notifications|messages|reminders)|receive.{0,30}\btexts?\b|opt.?in.{0,30}(text|sms)|(text|sms).{0,30}opt.?in/i;
export const wantsSms = (profile) => /^\s*y/i.test(profile?.sms_opt_in || '');

// Fields that come from the profile; they're never stored in the answer bank.
export const PROFILE_DRIVEN = new Set([
  'first_name', 'last_name', 'preferred_name', 'email', 'phone', 'name', 'org', 'location', 'resume',
  'urls[LinkedIn]', 'urls[GitHub]', 'urls[Portfolio]', 'urls[Other]',
]);

// Regexes pick a dropdown option; the trailing string is the answer for a text box.
const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const stateNames = (s) => {
  const v = (s || '').trim();
  return [STATES[v.toUpperCase()], v].filter(Boolean);
};

const yesNo = (v) => (/^\s*y/i.test(v || '') ? [YES, 'Yes'] : [NO, /^i (do not|don't|will not|won't)/i, 'No']);
// Voluntary self-ID. Forms word the same answer many ways, so map the profile value to patterns.
const declined = (v) => !v || /^decline/i.test(v.trim());
const eeo = (v) => (declined(v) ? [DECLINE] : [v, DECLINE]);
const gender = (v) => {
  if (declined(v)) return [DECLINE];
  if (/^(m|male|man)$/i.test(v.trim())) return [/^male$/i, /^man$/i, /^(cis(gender)? )?(male|man)\b/i, DECLINE];
  if (/^(f|female|woman)$/i.test(v.trim())) return [/^female$/i, /^woman$/i, /^(cis(gender)? )?(female|woman)\b/i, DECLINE];
  return [v, DECLINE];
};
const veteran = (v) => {
  if (declined(v)) return [DECLINE];
  if (/^(no|not)\b|not a (protected )?veteran/i.test(v.trim())) {
    return [/^i am not a (protected )?veteran|^not a (protected )?veteran|^no\b|(have not|never) served|no military/i, DECLINE];
  }
  return [v, DECLINE];
};
const disability = (v) => {
  if (declined(v)) return [DECLINE];
  if (/^(no|none)\b|no disability|do not have/i.test(v.trim())) return [/^no\b|do(n'?t| not) have a disability/i, DECLINE];
  return [v, DECLINE];
};
const STRAIGHT = /^(heterosexual|straight)$/i;
const orientation = (v) => {
  if (declined(v)) return [DECLINE];
  if (STRAIGHT.test(v.trim())) return [/^heterosexual/i, /^straight/i, /heterosexual|straight/i, DECLINE];
  return [v, DECLINE];
};
const transgender = (v) => (declined(v) ? [DECLINE] : /^n/i.test(v.trim()) ? [NO, DECLINE] : /^y/i.test(v.trim()) ? [YES, DECLINE] : [v, DECLINE]);
// "Do you identify as LGBTQ+?" follows from the two answers above.
const lgbtq = (p) =>
  !declined(p.sexual_orientation) && STRAIGHT.test(p.sexual_orientation.trim()) && /^n/i.test((p.transgender || '').trim())
    ? [NO, DECLINE]
    : [DECLINE];
// "Are you (or a relative) a government official / ever employed by a government?" Not clearance or
// eligibility questions ("able to work on government contracts"); those are left for you.
const government = (p, q) => {
  if (!/^\s*n/i.test(p.government_ties || '')) return null;
  if (/clearance|eligib|able to|citizen|contract/i.test(q.label)) return null;
  return [NO, /\b(have not|haven.t|never|not|none)\b/i, 'No'];
};

// A yes/no "Are you Hispanic or Latino?" On self-ID forms the race categories (White, Asian, ...) mean
// not Hispanic or Latino. No DECLINE fallback here, so a race list that mentions Hispanic falls to the race rule.
const hispanic = (race) => {
  if (declined(race)) return [DECLINE];
  return /hispanic|latin/i.test(race) ? [YES] : [NO];
};
const fullName = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ');
const inWA = (p) => /^(wa|washington)$/i.test((p.state || '').trim());

const BY_NAME = {
  first_name: (p) => p.first_name,
  last_name: (p) => p.last_name,
  preferred_name: (p) => p.preferred_name || p.first_name,
  email: (p) => p.email,
  phone: (p) => p.phone,
  name: (p) => fullName(p),
  org: (p) => p.current_company,
  location: (p) => [p.city, p.state].filter(Boolean).join(', '),
  'urls[LinkedIn]': (p) => p.linkedin,
  'urls[GitHub]': (p) => p.github,
  'urls[Portfolio]': (p) => p.website,
};

// [label test, answer(profile, question), selectOnly?]
const AUTO_RULES = [
  [/linkedin/i, (p) => p.linkedin],
  [/github/i, (p) => p.github],
  [/^(personal )?(website|portfolio)|website url|portfolio (url|link)/i, (p) => p.website],
  // No different preferred name in the profile means the legal name is the one you go by.
  [/legal name.{0,40}(same|match)|same as your (legal|preferred) name/i,
    (p) => (!p.preferred_name || p.preferred_name === p.first_name ? [YES, 'Yes'] : null)],
  [/preferred (first )?name/i, (p) => p.preferred_name || p.first_name],
  [/pronoun/i, (p) => (p.pronouns ? [p.pronouns, new RegExp(`^${escapeRe(p.pronouns.split('/')[0].trim())}\\b`, 'i')] : null)],
  [/^(legal )?first name/i, (p) => p.first_name],
  [/^(legal )?last name|surname/i, (p) => p.last_name],
  [/^(legal )?full name$|^name$/i, (p) => fullName(p)],
  [/^e-?mail/i, (p) => p.email],
  [/^(phone|mobile|cell)/i, (p) => p.phone],
  [/(government|public|foreign) official|official of (any|a) government|member of the military|politically exposed|(government|public sector) (employee|employment|position|role)/i, government],
  [/(currently|previously|ever|formerly|have you|are you).{0,40}(work(ed|ing)?|employ(ed)?|serv(ed|ing)).{0,40}(government|federal|state agency|public sector|municipal)/i, government],
  [/(relative|family|related to|spouse|partner|household).{0,80}(government|official)/i, government],
  [/(authori[sz]ed|eligible|legally able|permitted|right) to work/i, (p) => yesNo(p.work_authorized)],
  [/eligible to (begin|start) (employment|work)|legally (eligible|authori[sz]ed) to (begin|start)/i, (p) => yesNo(p.work_authorized)],
  [/(country|region).{0,30}citizenship|citizenship.{0,30}(country|region)|country of citizenship/i,
    (p) => (p.citizenship ? [p.citizenship, /^united states of america$/i.test(p.citizenship) ? null : 'United States of America', /^united states/i] : null)],
  [/sponsor/i, (p) => yesNo(p.needs_sponsorship)],
  [/\b(18|eighteen) (years|or older)|at least 18/i, () => [YES, 'Yes']],
  [/(countr(y|ies)).{0,60}(anticipate|plan|intend|expect|will be).{0,20}work/i, (p) => [p.country, 'United States', 'United States of America', 'USA', 'US']],
  [/(country|countries).{0,40}(reside|live|located|based)|(reside|live|located|based).{0,30}country|current country|country of residence/i, (p) => [p.country, 'United States', 'United States of America', 'USA', 'US']],
  [/(current|most recent|previous|present).{0,25}(employer|company)|^company name/i, (p) => p.current_company],
  [/(current|most recent|previous|present).{0,25}(job )?title|current (role|position)/i, (p) => p.current_title],
  [/city,? (and )?state|(current|permanent|home) (work )?location|where are you (currently )?(located|based)|where do you (currently )?live/i,
    (p) => [p.city && p.state ? `${p.city}, ${p.state}` : '', ...stateNames(p.state)]],
  [/^(current )?city$/i, (p) => p.city],
  [/^state(\/province)?$/i, (p) => (/^[a-z]{2}$/i.test(p.state || '') ? [p.state, ...stateNames(p.state)] : stateNames(p.state))],
  [/(state|province).{0,40}(reside|live|located|based)|(reside|live|located|based).{0,40}(state|province)|state of residence/i, (p) => stateNames(p.state)],
  [/zip|postal code/i, (p) => p.zip],
  [/street address|^address( line ?1)?$/i, (p) => p.address],
  // These come before the gender rule: "Do you identify as transgender?" contains "gender".
  [/transgender|trans experience/i, (p) => transgender(p.transgender), true],
  [/lgbt|queer/i, (p) => lgbtq(p), true],
  [/sexual orientation/i, (p) => orientation(p.sexual_orientation), true],
  [/gender|\bsex\b/i, (p) => gender(p.gender), true],
  [/hispanic|latin[oax]/i, (p) => hispanic(p.race), true],
  [/race|ethnic|hispanic|latin/i, (p) => eeo(p.race), true],
  [/veteran|armed forces|military (service|status)|served in the (military|armed)/i, (p) => veteran(p.veteran), true],
  [/disabilit/i, (p) => disability(p.disability), true],
];

const SUGGESTED_RULES = [
  // Follow-ups to a question answered "no" ("If yes, who referred you?").
  [/^if (yes|so)\b/i, () => [/^n\/?a\b|not applicable|^none/i, 'N/A']],
  [/(citizen|resident) of any of the following|sanctioned|embargoed/i, () => [NO, 'No']],
  [/(live|located|based|reside).{0,25}(in|near|around).{0,30}(seattle|bellevue|redmond|puget|washington|\bwa\b)/i, (p) => (inWA(p) ? [YES, 'Yes'] : yesNo(p.willing_to_relocate))],
  [/relocat/i, (p) => yesNo(p.willing_to_relocate)],
  [/outside (of )?the (us|u\.s\.|united states).{0,80}(12|twelve) (consecutive )?months|(12|twelve) consecutive months.{0,80}outside/i, () => [NO, 'No']],
  [/permanent resident.{0,60}(other|another) country/i, () => [NO, 'No']],
  [/(do you have|have you (earned|completed)|do you hold).{0,20}\b(a|an)\b.{0,10}(bachelor|master|associate)/i,
    (p, q) => {
      const level = /bachelor/i.test(q.label) ? /bachelor|master|ph\.?d|doctor/i : /master/i.test(q.label) ? /master|ph\.?d|doctor/i : /associate|bachelor|master|ph\.?d|doctor/i;
      return level.test(p.degree || '') ? [YES, 'Yes'] : null;
    }],
  [/how many years|years of.{0,40}experience|experience.{0,20}years|total.{0,40}(professional|software|development|engineering).{0,200}experience/i,
    (p) => ({ years: p.years_experience })],
  [/salary|compensation|pay (expectation|requirement|range)|expected pay/i, (p) => p.desired_salary],
  [/how did you (first )?(hear|find|learn|discover|come across)|where did you (first )?(hear|find|see|learn)|referral source|^source$/i,
    (p) => [p.how_heard, /company (web)?site|career'?s? ?(web)?site|careers? page|job (site|posting)|website/i, /job board/i, /linkedin/i, /^other/i]],
  [/\breferr(ed|al)|know anyone|employee referral/i, () => [NO, /^none/i, /^n\/a/i, 'No']],
  [/(previously|ever|currently|formerly|have you).{0,40}(work|employ)|former employee|current employee/i,
    () => [NO, /\b(have not|haven.t|never|not previously|not been)\b/i, 'No']],
  [/non-?compete|non-?solicit|restrictive covenant/i, () => [NO, 'No']],
  [/accommodation/i, () => [NO, 'No']],
  [/(able|willing|comfortable).{0,30}(work|commute|come).{0,40}(office|on-?site|hybrid|in person|days)/i, () => [YES, 'Yes']],
  [/time ?zone/i, () => [/pacific/i, /\bPST\b|\bPT\b/, 'Pacific Time']],
  [/start date|when can you start|available to start|notice period|earliest/i, (p) => p.notice_period],
  [/degree|education level|highest level of education/i, (p) => [p.degree, /bachelor/i]],
  [/school|university|college/i, (p) => p.school],
  [/acknowledge|consent|i agree|agree to|i have read|privacy|certify|confirm|attest|understand/i, () => [/acknowledge|agree|^yes|confirm|^i have|^i do|accept|understand|certify/i], true],
];

export function pickOption(options, wanted) {
  if (!options?.length) return null;
  for (const w of Array.isArray(wanted) ? wanted : [wanted]) {
    if (w == null || w === '') continue;
    if (w instanceof RegExp) {
      const o = options.find((x) => w.test(x.label));
      if (o) return o.label;
      continue;
    }
    const s = String(w).trim().toLowerCase();
    const exact = options.find((x) => x.label.trim().toLowerCase() === s);
    if (exact) return exact.label;
    const starts = options.find((x) => x.label.trim().toLowerCase().startsWith(s));
    if (starts && s.length > 1) return starts.label;
    const inside = s.length > 3 && options.find((x) => x.label.toLowerCase().includes(s));
    if (inside) return inside.label;
  }
  return null;
}

// The range of years an option covers: "1-3 years", "4 years to less than 5 years", "less than 10 months",
// "more than 3 years", "4+ years", "Over 6 years". Months count as fractions of a year.
function yearRange(label) {
  const t = label.toLowerCase();
  const unit = (u) => (/month/.test(u || '') ? 1 / 12 : 1);
  const n = '(\\d+(?:\\.\\d+)?)\\s*(years?|yrs?|months?)?';
  const tiny = 1e-6;
  let m;
  if ((m = new RegExp(`${n}\\s*(?:-|–|to)\\s*(less than\\s*)?${n}`).exec(t))) {
    return [+m[1] * unit(m[2] || m[5]), +m[4] * unit(m[5] || m[2]) - (m[3] ? tiny : 0)];
  }
  if ((m = new RegExp(`(?:over|more than|greater than)\\s*${n}`).exec(t))) return [+m[1] * unit(m[2]) + tiny, Infinity];
  if ((m = new RegExp(`${n}\\s*(?:\\+|or more)`).exec(t))) return [+m[1] * unit(m[2]), Infinity];
  if ((m = new RegExp(`at least\\s*${n}`).exec(t))) return [+m[1] * unit(m[2]), Infinity];
  if ((m = new RegExp(`(?:less than|under|fewer than)\\s*${n}`).exec(t))) return [0, +m[1] * unit(m[2]) - tiny];
  if ((m = /^(\d+)\b/.exec(t))) return [+m[1], +m[1]];
  if (/^none|no experience/.test(t)) return [0, 0];
  return null;
}

// The option whose range contains `years`.
export function pickYears(options, years) {
  const y = Number(String(years).replace(/[^\d.]/g, ''));
  if (!options?.length || !String(years).trim() || !Number.isFinite(y)) return null;
  for (const o of options) {
    const r = yearRange(o.label);
    if (r && y >= r[0] && y <= r[1]) return o.label;
  }
  return null;
}

// Turn a rule's answer into a value that fits the question, or null.
function fit(q, ans) {
  if (ans == null || ans === '') return null;
  if (q.type === 'select' || q.type === 'multiselect') {
    const label = ans.years !== undefined ? pickYears(q.options, ans.years) : pickOption(q.options, ans);
    if (!label) return null;
    return q.type === 'multiselect' ? [label] : label;
  }
  if (ans.years !== undefined) return ans.years ? String(ans.years) : null;
  if (Array.isArray(ans)) {
    const s = ans.find((x) => typeof x === 'string' && x);
    return s || null;
  }
  return typeof ans === 'string' && ans.trim() ? ans : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function bankKey(label, company, type) {
  let s = String(label || '');
  if (company) s = s.replace(new RegExp(escapeRe(company), 'gi'), '{company}');
  return `${s.toLowerCase().replace(/[^a-z0-9{} ]+/g, ' ').replace(/\s+/g, ' ').trim()}|${type}`;
}

export function toBank(value, company) {
  if (!company) return value;
  const re = new RegExp(escapeRe(company), 'gi');
  return Array.isArray(value) ? value.map((v) => String(v).replace(re, '{company}')) : String(value).replace(re, '{company}');
}

export function fromBank(value, company) {
  const sub = (v) => String(v).replace(/\{company\}/g, company || 'your company');
  return Array.isArray(value) ? value.map(sub) : sub(value);
}

// A banked answer still has to fit this form (the option labels can differ between companies).
function fitBanked(q, value) {
  if (q.type === 'select') return typeof value === 'string' ? pickOption(q.options, [value]) : null;
  if (q.type === 'multiselect') {
    const labels = (Array.isArray(value) ? value : [value]).map((v) => pickOption(q.options, [v])).filter(Boolean);
    return labels.length ? labels : null;
  }
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * @param form    { questions: [...] }
 * @param profile the profile object
 * @param bank    Map of bankKey -> stored answer (already JSON-parsed)
 * @param company the job's company, for {company} substitution
 */
export function autofill(form, profile, bank = new Map(), company = '') {
  const values = {};
  const bucket = {};
  for (const q of form?.questions || []) {
    const set = (v, b) => {
      values[q.name] = v;
      bucket[q.name] = b;
    };

    if (q.kind === 'resume') { set('__resume__', 'auto'); continue; }
    if (q.type === 'file') { bucket[q.name] = q.required ? 'open' : 'optional'; continue; }

    if (BY_NAME[q.name]) {
      const v = fit(q, BY_NAME[q.name](profile));
      if (v) { set(v, 'auto'); continue; }
    }

    // Text the site already has filled in (your account's phone, name) stays as it is. Not email: applications
    // always use the profile's email, even when you sign in to a site with a different one.
    if ((q.type === 'text' || q.type === 'textarea') && typeof q.preset === 'string' && q.preset.trim() && !/e-?mail/i.test(q.label)) {
      set(q.preset, 'auto');
      continue;
    }

    if (SMS.test(q.label)) {
      const yes = wantsSms(profile);
      const v = fit(q, yes
        ? [YES, /agree|consent|opt.?in|i (would|do)\b/i, 'Yes']
        : [NO, /do not|don.?t|opt.?out|decline|no thanks/i, 'No']);
      if (v) set(v, 'auto');
      // Opted out and the only choice is "I agree": leave it unchecked.
      else bucket[q.name] = q.required ? 'open' : 'auto';
      continue;
    }

    let done = false;
    for (const [re, answer, selectOnly] of AUTO_RULES) {
      if (!re.test(q.label)) continue;
      if (selectOnly && q.type !== 'select' && q.type !== 'multiselect') continue;
      const v = fit(q, answer(profile, q));
      if (v) { set(v, 'auto'); done = true; break; }
    }
    if (done) continue;

    const banked = bank.get(bankKey(q.label, company, q.type));
    if (banked !== undefined) {
      const v = fitBanked(q, fromBank(banked, company));
      if (v) { set(v, 'suggested'); continue; }
    }

    // Already answered on the site itself (Amazon remembers your answers from earlier applications).
    if (q.preset !== undefined && q.preset !== null && q.preset !== '') {
      const v = fitBanked(q, q.preset);
      if (v) { set(v, 'auto'); continue; }
    }

    for (const [re, answer, selectOnly] of SUGGESTED_RULES) {
      if (!re.test(q.label)) continue;
      if (selectOnly && q.type !== 'select' && q.type !== 'multiselect') continue;
      const v = fit(q, answer(profile, q));
      if (v) { set(v, 'suggested'); done = true; break; }
    }
    if (done) continue;

    if (q.section === 'demographic' && (q.type === 'select' || q.type === 'multiselect')) {
      const v = fit(q, [DECLINE]);
      if (v) { set(v, 'auto'); continue; }
    }

    // Only one choice (e.g. a job with a single location): take it.
    if (q.type === 'select' && q.required && q.options?.length === 1) {
      set(q.options[0].label, 'auto');
      continue;
    }

    bucket[q.name] = q.required ? 'open' : 'optional';
  }
  return { values, bucket };
}

// The required questions that still have no answer.
export function missingRequired(form, answers) {
  return (form?.questions || []).filter((q) => {
    if (!q.required || q.kind === 'resume') return false;
    const v = answers[q.name];
    return v == null || v === '' || (Array.isArray(v) && v.length === 0);
  });
}
