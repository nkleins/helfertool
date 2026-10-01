import { randomBytes } from 'node:crypto';
import { listShifts, getShift } from '../repositories/shifts.js';
import { listAreas } from '../repositories/areas.js';
import { createSignup, listSignupsByShift, listByToken, cancelOwnSignup } from '../repositories/signups.js';
import { validateSignupInput } from '../validate.js';
import { displayName, formatTime, formatDay, localNow, pastCutoff } from '../display.js';
import { requireCsrf, rateLimiter } from '../server.js';
import { translator, LANGS } from '../i18n.js';

const HTOKEN_MAX_AGE = 60 * 60 * 24 * 120; // 120 Tage

// orga=false: Teilnehmer-Schichten, Namen gekürzt ("Vorname N."), kein Telefon.
// orga=true:  Orga-Schichten, voller Name + Telefonnummer (Orga-Koordination).
// Englischer Text, falls gepflegt und Englisch gewählt – sonst der deutsche.
const pick = (lang, de, en) => (lang === 'en' && en ? en : de);

function buildAreaGroups(db, orga, cutoff, lang) {
  const areas = listAreas(db).map((a) => ({
    ...a,
    name: pick(lang, a.name, a.name_en),
    description: pick(lang, a.description, a.description_en),
    searchText: [a.name, a.name_en].filter(Boolean).join(' '),
  }));
  const shifts = listShifts(db).filter((s) => Boolean(s.is_orga) === orga);
  const byArea = new Map(areas.map((a) => [a.id, { ...a, shifts: [] }]));
  for (const s of shifts) {
    const g = byArea.get(s.area_id);
    if (!g) continue;
    g.shifts.push({
      ...s,
      title: pick(lang, s.title, s.title_en),
      notes: pick(lang, s.notes, s.notes_en),
      searchText: [s.title, s.title_en, s.notes, s.notes_en].filter(Boolean).join(' '),
      time: `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`,
      day: s.starts_at.slice(0, 10),
      dayLabel: formatDay(s.starts_at),
      isPast: s.ends_at <= cutoff,
      people: listSignupsByShift(db, s.id).map((x) => ({
        display: orga ? x.name : displayName(x.name),
        phone: orga ? (x.phone || '') : '',
      })),
    });
  }
  // Bereiche ohne passende Schicht (kein Tab-Inhalt) ausblenden.
  return [...byArea.values()].filter((g) => g.shifts.length > 0);
}

// Gemeinsame Daten für alle öffentlichen Seiten (Sprache + Umschalter).
function pub(req, data) {
  // Nach einem POST (Formularfehler) zurück auf die passende Listen-Seite.
  const path = req.method === 'GET' ? req.url : (req.url.startsWith('/orga') ? '/orga' : '/');
  return { lang: req.lang, langSwitch: true, path, ...data };
}

function render(app, req, extra = {}) {
  const orga = Boolean(extra.orga);
  const t = translator(req.lang);
  const now = app.config.now ? app.config.now() : localNow(app.config.timeZone);
  const areas = buildAreaGroups(app.db, orga, pastCutoff(now), req.lang);
  const days = [...new Map(areas.flatMap((a) => a.shifts).map((s) => [s.day, s.dayLabel])).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, label]) => ({ value, label: `${t.list('weekdays')[new Date(`${value}T12:00Z`).getUTCDay()]} ${label}` }));
  return app.render('public-list', pub(req, {
    title: t(orga ? 'title.orga' : 'title.help'), orga,
    areas, days, csrf: req.session.csrf,
    action: orga ? '/orga/signup' : '/signup',
    errors: [], values: {}, ...extra,
  }));
}

export function registerPublicRoutes(app) {
  const db = app.db;
  const signupLimit = rateLimiter(app, {
    max: app.config.signupRateMax ?? 120, timeWindow: '1 minute', keyGenerator: () => 'signup',
  });

  async function handleSignup(req, reply, orga) {
    if (!(await signupLimit(req, reply))) return;
    if (!requireCsrf(req, reply)) return;
    const result = validateSignupInput(req.body);
    const shiftId = Number.parseInt(req.body.shift_id, 10);
    const t = translator(req.lang);
    if (!result.ok) {
      return reply.code(200).type('text/html').send(render(app, req, { orga, errors: result.errors.map(t.message), values: req.body }));
    }
    const shift = getShift(db, shiftId);
    if (shift && shift.requires_phone && !result.value.phone) {
      return reply.code(200).type('text/html').send(render(app, req, {
        orga, errors: [t('err.phoneRequired')], values: req.body,
      }));
    }
    let token = req.cookies?.htoken;
    if (!token) {
      token = randomBytes(16).toString('hex');
      reply.setCookie('htoken', token, {
        httpOnly: true, sameSite: 'lax', secure: app.config.secureCookie, path: '/', maxAge: HTOKEN_MAX_AGE,
      });
    }
    const created = createSignup(db, { shift_id: shiftId, ...result.value, device_token: token });
    if (!created.ok) {
      const msg = t(created.reason === 'full' ? 'err.full' : 'err.notFound');
      return reply.code(200).type('text/html').send(render(app, req, { orga, errors: [msg], values: req.body }));
    }
    return reply.redirect(orga ? '/orga' : '/danke');
  }

  app.get('/', (req, reply) => {
    reply.type('text/html').send(render(app, req, {}));
  });

  app.post('/signup', (req, reply) => handleSignup(req, reply, false));

  app.get('/orga', (req, reply) => {
    reply.type('text/html').send(render(app, req, { orga: true }));
  });

  app.post('/orga/signup', (req, reply) => handleSignup(req, reply, true));

  app.get('/danke', (req, reply) => {
    reply.type('text/html').send(app.render('confirm', pub(req, { title: translator(req.lang)('title.thanks') })));
  });

  app.get('/meine', (req, reply) => {
    const token = req.cookies?.htoken;
    const items = listByToken(db, token).map((s) => ({
      ...s, area_name: pick(req.lang, s.area_name, s.area_name_en), title: pick(req.lang, s.title, s.title_en),
      time: `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`, dayLabel: formatDay(s.starts_at),
    }));
    reply.type('text/html').send(app.render('meine', pub(req, {
      title: translator(req.lang)('title.mine'), items, csrf: req.session.csrf,
    })));
  });

  app.post('/signup/:id/cancel', (req, reply) => {
    if (!requireCsrf(req, reply)) return;
    cancelOwnSignup(db, Number(req.params.id), req.cookies?.htoken);
    return reply.redirect('/meine');
  });

  // Sprachumschalter: merkt sich die Wahl ein Jahr lang und geht zurück zur Seite.
  app.get('/lang/:code', (req, reply) => {
    const code = LANGS.includes(req.params.code) ? req.params.code : 'de';
    reply.setCookie('lang', code, {
      httpOnly: true, sameSite: 'lax', secure: app.config.secureCookie, path: '/', maxAge: 60 * 60 * 24 * 365,
    });
    const back = String(req.query.back ?? '/');
    // Nur Pfade auf dieser Seite (kein //evil.example oder /\evil).
    const safe = /^\/(?![/\\])/.test(back) ? back : '/';
    return reply.redirect(safe);
  });
}
