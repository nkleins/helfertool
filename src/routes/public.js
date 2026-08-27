import { listShifts } from '../repositories/shifts.js';
import { createSignup } from '../repositories/signups.js';
import { validateSignupInput } from '../validate.js';
import { requireCsrf, rateLimiter } from '../server.js';

function groupByArea(shifts) {
  const map = new Map();
  for (const s of shifts) {
    if (!map.has(s.area)) map.set(s.area, []);
    map.get(s.area).push(s);
  }
  return [...map.entries()].map(([area, items]) => ({ area, items }));
}

export function registerPublicRoutes(app) {
  const db = app.db;
  const signupLimit = rateLimiter(app, {
    max: app.config.signupRateMax ?? 120,
    timeWindow: '1 minute',
    keyGenerator: () => 'signup',
  });

  app.get('/', (req, reply) => {
    const groups = groupByArea(listShifts(db));
    reply.type('text/html').send(app.render('public-list', {
      title: 'Helfen', groups, csrf: req.session.csrf, errors: [], values: {},
    }));
  });

  app.post('/signup', async (req, reply) => {
    if (!(await signupLimit(req, reply))) return;
    if (!requireCsrf(req, reply)) return;
    const result = validateSignupInput(req.body);
    const shiftId = Number.parseInt(req.body.shift_id, 10);
    if (!result.ok) {
      const groups = groupByArea(listShifts(db));
      return reply.code(200).type('text/html').send(app.render('public-list', {
        title: 'Helfen', groups, csrf: req.session.csrf,
        errors: result.errors, values: req.body,
      }));
    }
    const created = createSignup(db, { shift_id: shiftId, ...result.value });
    if (!created.ok) {
      const msg = created.reason === 'full'
        ? 'Diese Schicht ist leider schon voll.'
        : 'Schicht nicht gefunden.';
      const groups = groupByArea(listShifts(db));
      return reply.code(200).type('text/html').send(app.render('public-list', {
        title: 'Helfen', groups, csrf: req.session.csrf, errors: [msg], values: req.body,
      }));
    }
    return reply.redirect('/danke');
  });

  app.get('/danke', (req, reply) => {
    reply.type('text/html').send(app.render('confirm', { title: 'Danke' }));
  });
}
