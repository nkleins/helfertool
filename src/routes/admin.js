import QRCode from 'qrcode';
import { verifyPassword, createSession, deleteSession } from '../auth.js';
import { requireCsrf, rateLimiter } from '../server.js';
import { getShift, updateShift, deleteShift, listShifts, generateShifts, planSlots, areaStats, deleteShiftsByAreaDay } from '../repositories/shifts.js';
import { listSignupsByShift, createSignup, deleteSignup, moveSignup, listAllSignups } from '../repositories/signups.js';
import { validateShiftInput, validateSignupInput, validateAreaInput, validateGenerateInput } from '../validate.js';
import { listAreas, createArea, getArea, updateArea, deleteArea } from '../repositories/areas.js';
import { signupsCsv } from '../csv.js';
import { displayName, formatTime, formatDay } from '../display.js';

export function requireAdmin(req, reply) {
  if (!req.isAdmin) {
    reply.redirect('/admin/login');
    return false;
  }
  return true;
}

export function registerAdminRoutes(app) {
  const db = app.db;
  const config = app.config;

  const loginLimit = rateLimiter(app, { max: 10, timeWindow: '1 minute', keyGenerator: () => 'login' });

  app.get('/admin/login', (req, reply) => {
    reply.type('text/html').send(app.render('admin-login', {
      title: 'Login', csrf: req.session.csrf, error: null,
    }));
  });

  app.post('/admin/login', async (req, reply) => {
    if (!(await loginLimit(req, reply))) return;
    if (!requireCsrf(req, reply)) return;
    const { username, password } = req.body;
    const ok = username === config.adminUser
      && verifyPassword(password ?? '', config.adminPasswordHash);
    if (!ok) {
      return reply.code(200).type('text/html').send(app.render('admin-login', {
        title: 'Login', csrf: req.session.csrf,
        error: 'Benutzername oder Passwort ist falsch.',
      }));
    }
    deleteSession(db, req.session.id);
    const created = createSession(db, { isAdmin: true });
    reply.setCookie('sid', created.id, {
      httpOnly: true, sameSite: 'lax', secure: config.secureCookie, path: '/',
    });
    return reply.redirect('/admin');
  });

  app.post('/admin/logout', (req, reply) => {
    if (!requireCsrf(req, reply)) return;
    deleteSession(db, req.session.id);
    return reply.redirect('/admin/login');
  });

  app.get('/admin', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const shifts = listShifts(db);
    // Gruppierung nach Bereich → Tag
    const groups = [];
    const index = new Map();
    for (const s of shifts) {
      const day = s.starts_at.slice(0, 10);
      const key = `${s.area_id}|${day}`;
      if (!index.has(key)) {
        const g = { area_id: s.area_id, area_name: s.area_name, area_color: s.area_color, day, dayLabel: formatDay(s.starts_at), items: [] };
        index.set(key, g); groups.push(g);
      }
      index.get(key).items.push({ ...s, time: `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}` });
    }
    reply.type('text/html').send(app.render('admin-dashboard', {
      title: 'Dashboard', stats: areaStats(db), groups, csrf: req.session.csrf,
    }));
  });

  app.post('/admin/shifts/bulk-delete', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    deleteShiftsByAreaDay(db, Number(req.body.area_id), String(req.body.day));
    return reply.redirect('/admin');
  });

  app.get('/admin/shifts/new', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    reply.type('text/html').send(app.render('admin-generate', {
      title: 'Schichten erzeugen', areas: listAreas(db), csrf: req.session.csrf,
      values: { area_id: '', title: '', date: '', from: '', to: '', slot_minutes: '60', capacity: '2', notes: '' },
      errors: [], preview: null,
    }));
  });

  app.post('/admin/shifts/generate', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const v = validateGenerateInput(req.body);
    if (!v.ok) {
      return reply.code(200).type('text/html').send(app.render('admin-generate', {
        title: 'Schichten erzeugen', areas: listAreas(db), csrf: req.session.csrf,
        values: req.body, errors: v.errors, preview: null,
      }));
    }
    const slots = planSlots(v.value);
    if (slots.length === 0) {
      return reply.code(200).type('text/html').send(app.render('admin-generate', {
        title: 'Schichten erzeugen', areas: listAreas(db), csrf: req.session.csrf,
        values: req.body, errors: ['Das Zeitfenster ist kürzer als eine Schicht.'], preview: null,
      }));
    }
    generateShifts(db, v.value);
    return reply.redirect('/admin');
  });

  app.get('/admin/shifts/:id/edit', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const shift = getShift(db, Number(req.params.id));
    if (!shift) return reply.code(404).send('Schicht nicht gefunden.');
    reply.type('text/html').send(app.render('admin-shift-form', {
      title: 'Schicht bearbeiten', csrf: req.session.csrf,
      action: `/admin/shifts/${shift.id}`, shift, areas: listAreas(db), errors: [],
    }));
  });

  app.post('/admin/shifts/:id', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const id = Number(req.params.id);
    const v = validateShiftInput(req.body);
    if (!v.ok) {
      return reply.code(200).type('text/html').send(app.render('admin-shift-form', {
        title: 'Schicht bearbeiten', csrf: req.session.csrf,
        action: `/admin/shifts/${id}`, shift: { ...req.body, id }, areas: listAreas(db), errors: v.errors,
      }));
    }
    updateShift(db, id, v.value);
    return reply.redirect('/admin');
  });

  app.post('/admin/shifts/:id/delete', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    deleteShift(db, Number(req.params.id));
    return reply.redirect('/admin');
  });

  app.get('/admin/shifts/:id', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number(req.params.id);
    const shift = getShift(db, id);
    if (!shift) return reply.code(404).send('Schicht nicht gefunden.');
    const area = getArea(db, shift.area_id);
    const signups = listSignupsByShift(db, id);
    const others = listShifts(db).filter((s) => s.id !== id);
    reply.type('text/html').send(app.render('admin-shift-detail', {
      title: shift.title, shift: { ...shift, area_name: area ? area.name : '' }, signups, others, csrf: req.session.csrf, errors: [],
    }));
  });

  app.post('/admin/shifts/:id/signups', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const id = Number(req.params.id);
    const v = validateSignupInput(req.body);
    if (v.ok) {
      const r = createSignup(db, { shift_id: id, ...v.value });
      if (!r.ok && r.reason === 'full') {
        const shift = getShift(db, id);
        const area = getArea(db, shift.area_id);
        const signups = listSignupsByShift(db, id);
        const others = listShifts(db).filter((s) => s.id !== id);
        return reply.code(200).type('text/html').send(app.render('admin-shift-detail', {
          title: shift.title, shift: { ...shift, area_name: area ? area.name : '' }, signups, others, csrf: req.session.csrf,
          errors: ['Schicht ist voll.'],
        }));
      }
    }
    return reply.redirect(`/admin/shifts/${id}`);
  });

  app.post('/admin/signups/:sid/delete', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    deleteSignup(db, Number(req.params.sid));
    return reply.redirect(`/admin/shifts/${Number(req.body.shift_id)}`);
  });

  app.post('/admin/signups/:sid/move', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const target = Number(req.body.target_shift_id);
    moveSignup(db, Number(req.params.sid), target);
    return reply.redirect(`/admin/shifts/${target}`);
  });

  app.get('/admin/export.csv', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const csv = signupsCsv(listAllSignups(db));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="helfer-export.csv"')
      .send('﻿' + csv); // BOM für Excel
  });

  app.get('/admin/qr', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const url = `${config.baseUrl}/`;
    const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 2 });
    reply.type('text/html').send(app.render('admin-qr', {
      title: 'QR-Code', url, dataUrl, csrf: req.session.csrf,
    }));
  });

  app.get('/admin/qr.svg', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const svg = await QRCode.toString(`${config.baseUrl}/`, { type: 'svg', margin: 2 });
    reply.header('Content-Type', 'image/svg+xml').send(svg);
  });

  app.get('/admin/areas', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    reply.type('text/html').send(app.render('admin-areas', {
      title: 'Bereiche', areas: listAreas(db), csrf: req.session.csrf, errors: [],
    }));
  });

  app.post('/admin/areas', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const v = validateAreaInput(req.body);
    if (!v.ok) {
      return reply.code(200).type('text/html').send(app.render('admin-areas', {
        title: 'Bereiche', areas: listAreas(db), csrf: req.session.csrf, errors: v.errors,
      }));
    }
    createArea(db, v.value);
    return reply.redirect('/admin/areas');
  });

  app.post('/admin/areas/:id', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const id = Number(req.params.id);
    if (!getArea(db, id)) return reply.code(404).send('Bereich nicht gefunden.');
    const v = validateAreaInput(req.body);
    if (v.ok) updateArea(db, id, v.value);
    return reply.redirect('/admin/areas');
  });

  app.post('/admin/areas/:id/delete', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    deleteArea(db, Number(req.params.id));
    return reply.redirect('/admin/areas');
  });
}
