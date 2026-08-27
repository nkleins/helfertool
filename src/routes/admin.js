import QRCode from 'qrcode';
import { verifyPassword, createSession, deleteSession } from '../auth.js';
import { requireCsrf, rateLimiter } from '../server.js';
import { createShift, getShift, updateShift, deleteShift, listShifts } from '../repositories/shifts.js';
import { listSignupsByShift, createSignup, deleteSignup, moveSignup, listAllSignups } from '../repositories/signups.js';
import { validateShiftInput, validateSignupInput } from '../validate.js';
import { signupsCsv } from '../csv.js';

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
    reply.type('text/html').send(app.render('admin-dashboard', {
      title: 'Dashboard', shifts, csrf: req.session.csrf,
    }));
  });

  app.get('/admin/shifts/new', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    reply.type('text/html').send(app.render('admin-shift-form', {
      title: 'Neue Schicht', csrf: req.session.csrf, action: '/admin/shifts',
      shift: { area: '', title: '', starts_at: '', ends_at: '', capacity: 1, notes: '' },
      errors: [],
    }));
  });

  app.post('/admin/shifts', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const v = validateShiftInput(req.body);
    if (!v.ok) {
      return reply.code(200).type('text/html').send(app.render('admin-shift-form', {
        title: 'Neue Schicht', csrf: req.session.csrf, action: '/admin/shifts',
        shift: req.body, errors: v.errors,
      }));
    }
    createShift(db, v.value);
    return reply.redirect('/admin');
  });

  app.get('/admin/shifts/:id/edit', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const shift = getShift(db, Number(req.params.id));
    if (!shift) return reply.code(404).send('Schicht nicht gefunden.');
    reply.type('text/html').send(app.render('admin-shift-form', {
      title: 'Schicht bearbeiten', csrf: req.session.csrf,
      action: `/admin/shifts/${shift.id}`, shift, errors: [],
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
        action: `/admin/shifts/${id}`, shift: { ...req.body, id }, errors: v.errors,
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
    const signups = listSignupsByShift(db, id);
    const others = listShifts(db).filter((s) => s.id !== id);
    reply.type('text/html').send(app.render('admin-shift-detail', {
      title: shift.title, shift, signups, others, csrf: req.session.csrf, errors: [],
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
        const signups = listSignupsByShift(db, id);
        const others = listShifts(db).filter((s) => s.id !== id);
        return reply.code(200).type('text/html').send(app.render('admin-shift-detail', {
          title: shift.title, shift, signups, others, csrf: req.session.csrf,
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
}
