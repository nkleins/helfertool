import QRCode from 'qrcode';
import { verifyPassword, hashPassword, createSession, deleteSession } from '../auth.js';
import { requireCsrf, rateLimiter } from '../server.js';
import { getShift, updateShift, deleteShift, listShifts, generateShifts, planSlots, areaStats, deleteShiftsByAreaDay, resetAll } from '../repositories/shifts.js';
import { listSignupsByShift, createSignup, deleteSignup, updateSignup, listAllSignups } from '../repositories/signups.js';
import { validateShiftInput, validateSignupInput, validateAreaInput, validateGenerateInput, validateSettingsInput, validateUserInput, validateNewPassword, ALLOWED_SLOTS } from '../validate.js';
import { listAreas, createArea, getArea, updateArea, deleteArea } from '../repositories/areas.js';
import { getSettings, saveSettings, getLogoVersion, setLogo, clearLogo, detectImageMime } from '../repositories/settings.js';
import {
  PERMISSIONS, can, canSeeArea, getUserByName, listUsers, getUser, createUser, updateUserAccess,
  setPassword, deleteUser, deleteSessionsOfUser, grantArea,
} from '../repositories/users.js';
import { signupsCsv } from '../csv.js';
import { formatTime, formatDay } from '../display.js';
import { DONATE_URL } from '../project.js';

const RESET_PHRASE = 'ALLES LÖSCHEN';
// Bei unbekanntem Benutzernamen trotzdem einen Hash prüfen, damit die Antwortzeit
// nicht verrät, ob es den Account gibt.
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

function requireAdmin(req, reply) {
  if (!req.isAdmin) {
    reply.redirect('/admin/login');
    return false;
  }
  // Erst-Login mit Standardpasswort: erst Passwort ändern, dann weiter.
  if (req.user.must_change_password && req.routeOptions.url !== '/admin/password') {
    reply.redirect('/admin/password');
    return false;
  }
  return true;
}

export function registerAdminRoutes(app) {
  const db = app.db;

  const loginLimit = rateLimiter(app, { max: 10, timeWindow: '1 minute', keyGenerator: () => 'login' });

  function page(req, reply, view, data, code = 200) {
    const me = req.user;
    return reply.code(code).type('text/html').send(app.render(view, {
      csrf: req.session.csrf, me, can: (perm) => can(me, perm), ...data,
    }));
  }

  function forbidden(req, reply) {
    page(req, reply, 'admin-forbidden', { title: 'Keine Berechtigung' }, 403);
    return false;
  }

  function requirePerm(req, reply, perm) {
    if (!requireAdmin(req, reply)) return false;
    return can(req.user, perm) ? true : forbidden(req, reply);
  }

  function requireOwner(req, reply) {
    if (!requireAdmin(req, reply)) return false;
    return req.user.is_owner ? true : forbidden(req, reply);
  }

  // Schicht laden und prüfen, ob der Account ihren Bereich sehen darf.
  function scopedShift(req, reply, id) {
    const shift = getShift(db, Number(id));
    if (!shift) { reply.code(404).send('Schicht nicht gefunden.'); return null; }
    if (!canSeeArea(req.user, shift.area_id)) { forbidden(req, reply); return null; }
    return shift;
  }

  const myAreas = (req) => listAreas(db).filter((a) => canSeeArea(req.user, a.id));

  app.get('/admin/login', (req, reply) => {
    if (req.isAdmin) return reply.redirect('/admin');
    page(req, reply, 'admin-login', { title: 'Login', error: null });
  });

  app.post('/admin/login', async (req, reply) => {
    if (!(await loginLimit(req, reply))) return;
    if (!requireCsrf(req, reply)) return;
    const { username, password } = req.body;
    const user = getUserByName(db, String(username ?? '').trim());
    const ok = verifyPassword(password ?? '', user ? user.password_hash : DUMMY_HASH) && Boolean(user);
    if (!ok) {
      return page(req, reply, 'admin-login', { title: 'Login', error: 'Benutzername oder Passwort ist falsch.' });
    }
    deleteSession(db, req.session.id);
    const created = createSession(db, { isAdmin: true, userId: user.id });
    reply.setCookie('sid', created.id, {
      httpOnly: true, sameSite: 'lax', secure: app.config.secureCookie, path: '/',
    });
    return reply.redirect(user.must_change_password ? '/admin/password' : '/admin');
  });

  app.post('/admin/logout', (req, reply) => {
    if (!requireCsrf(req, reply)) return;
    deleteSession(db, req.session.id);
    return reply.redirect('/admin/login');
  });

  app.get('/admin', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const shifts = listShifts(db).filter((s) => canSeeArea(req.user, s.area_id));
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
      index.get(key).items.push({ ...s, time: `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`, people: listSignupsByShift(db, s.id) });
    }
    page(req, reply, 'admin-dashboard', {
      title: 'Dashboard', donateUrl: DONATE_URL, stats: areaStats(db).filter((a) => canSeeArea(req.user, a.area_id)), groups,
    });
  });

  app.post('/admin/shifts/bulk-delete', (req, reply) => {
    if (!requirePerm(req, reply, 'shifts')) return;
    if (!requireCsrf(req, reply)) return;
    const areaId = Number(req.body.area_id);
    if (!canSeeArea(req.user, areaId)) return forbidden(req, reply);
    deleteShiftsByAreaDay(db, areaId, String(req.body.day));
    return reply.redirect('/admin');
  });

  const generatePage = (req, reply, values, errors = []) => page(req, reply, 'admin-generate', {
    title: 'Schichten erzeugen', areas: myAreas(req), values, errors, slotOptions: ALLOWED_SLOTS,
  });

  app.get('/admin/shifts/new', (req, reply) => {
    if (!requirePerm(req, reply, 'shifts')) return;
    generatePage(req, reply, { area_id: '', title: '', date: '', from: '', to: '', slot_minutes: '60', capacity: '2', notes: '' });
  });

  app.post('/admin/shifts/generate', (req, reply) => {
    if (!requirePerm(req, reply, 'shifts')) return;
    if (!requireCsrf(req, reply)) return;
    const v = validateGenerateInput(req.body);
    if (!v.ok) return generatePage(req, reply, req.body, v.errors);
    if (!canSeeArea(req.user, v.value.area_id)) return forbidden(req, reply);
    const slots = planSlots(v.value);
    if (slots.length === 0) return generatePage(req, reply, req.body, ['Das Zeitfenster ist kürzer als eine Schicht.']);
    generateShifts(db, v.value);
    return reply.redirect('/admin');
  });

  app.get('/admin/shifts/:id/edit', (req, reply) => {
    if (!requirePerm(req, reply, 'shifts')) return;
    const shift = scopedShift(req, reply, req.params.id);
    if (!shift) return;
    page(req, reply, 'admin-shift-form', {
      title: 'Schicht bearbeiten', action: `/admin/shifts/${shift.id}`, shift, areas: myAreas(req), errors: [],
    });
  });

  app.post('/admin/shifts/:id', (req, reply) => {
    if (!requirePerm(req, reply, 'shifts')) return;
    if (!requireCsrf(req, reply)) return;
    const shift = scopedShift(req, reply, req.params.id);
    if (!shift) return;
    const v = validateShiftInput(req.body);
    if (!v.ok) {
      return page(req, reply, 'admin-shift-form', {
        title: 'Schicht bearbeiten', action: `/admin/shifts/${shift.id}`, shift: { ...req.body, id: shift.id },
        areas: myAreas(req), errors: v.errors,
      });
    }
    if (!canSeeArea(req.user, v.value.area_id)) return forbidden(req, reply);
    updateShift(db, shift.id, v.value);
    return reply.redirect('/admin');
  });

  app.post('/admin/shifts/:id/delete', (req, reply) => {
    if (!requirePerm(req, reply, 'shifts')) return;
    if (!requireCsrf(req, reply)) return;
    const shift = scopedShift(req, reply, req.params.id);
    if (!shift) return;
    deleteShift(db, shift.id);
    return reply.redirect('/admin');
  });

  function shiftDetail(req, reply, shift, errors = []) {
    const area = getArea(db, shift.area_id);
    const sameDay = shift.starts_at.slice(0, 10) === shift.ends_at.slice(0, 10);
    const when = `${formatDay(shift.starts_at)}, ${formatTime(shift.starts_at)}–${sameDay ? '' : `${formatDay(shift.ends_at)}, `}${formatTime(shift.ends_at)}`;
    return page(req, reply, 'admin-shift-detail', {
      title: shift.title || 'Schicht', when, shift: { ...shift, area_name: area ? area.name : '' },
      signups: listSignupsByShift(db, shift.id), errors,
    });
  }

  app.get('/admin/shifts/:id', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const shift = scopedShift(req, reply, req.params.id);
    if (!shift) return;
    shiftDetail(req, reply, shift);
  });

  app.post('/admin/shifts/:id/signups', (req, reply) => {
    if (!requirePerm(req, reply, 'signups')) return;
    if (!requireCsrf(req, reply)) return;
    const shift = scopedShift(req, reply, req.params.id);
    if (!shift) return;
    const v = validateSignupInput(req.body);
    if (!v.ok) return shiftDetail(req, reply, shift, v.errors);
    const r = createSignup(db, { shift_id: shift.id, ...v.value });
    if (!r.ok && r.reason === 'full') return shiftDetail(req, reply, shift, ['Schicht ist voll.']);
    return reply.redirect(`/admin/shifts/${shift.id}`);
  });

  // Schicht zum Eintrag aus der DB holen (nicht aus dem Formular), dann Bereich prüfen.
  function scopedSignupShift(req, reply) {
    const row = db.prepare('SELECT shift_id FROM signups WHERE id = ?').get(Number(req.params.sid));
    if (!row) { reply.redirect('/admin'); return null; }
    return scopedShift(req, reply, row.shift_id);
  }

  app.post('/admin/signups/:sid/delete', (req, reply) => {
    if (!requirePerm(req, reply, 'signups')) return;
    if (!requireCsrf(req, reply)) return;
    const shift = scopedSignupShift(req, reply);
    if (!shift) return;
    deleteSignup(db, Number(req.params.sid));
    return reply.redirect(`/admin/shifts/${shift.id}`);
  });

  app.post('/admin/signups/:sid', (req, reply) => {
    if (!requirePerm(req, reply, 'signups')) return;
    if (!requireCsrf(req, reply)) return;
    const shift = scopedSignupShift(req, reply);
    if (!shift) return;
    const v = validateSignupInput(req.body);
    if (!v.ok) return shiftDetail(req, reply, shift, v.errors);
    updateSignup(db, Number(req.params.sid), v.value);
    return reply.redirect(`/admin/shifts/${shift.id}`);
  });

  app.get('/admin/export.csv', (req, reply) => {
    if (!requirePerm(req, reply, 'export')) return;
    const csv = signupsCsv(listAllSignups(db).filter((r) => canSeeArea(req.user, r.area_id)));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="helfer-export.csv"')
      .send('﻿' + csv); // BOM für Excel
  });

  app.get('/admin/qr', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const url = `${app.config.baseUrl}/`;
    const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 2 });
    page(req, reply, 'admin-qr', { title: 'QR-Code', url, dataUrl });
  });

  app.get('/admin/qr.svg', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const svg = await QRCode.toString(`${app.config.baseUrl}/`, { type: 'svg', margin: 2 });
    reply.header('Content-Type', 'image/svg+xml').send(svg);
  });

  const areasPage = (req, reply, errors = []) => page(req, reply, 'admin-areas', {
    title: 'Bereiche', areas: myAreas(req), errors,
  });

  app.get('/admin/areas', (req, reply) => {
    if (!requirePerm(req, reply, 'areas')) return;
    areasPage(req, reply);
  });

  app.post('/admin/areas', (req, reply) => {
    if (!requirePerm(req, reply, 'areas')) return;
    if (!requireCsrf(req, reply)) return;
    const v = validateAreaInput(req.body);
    if (!v.ok) return areasPage(req, reply, v.errors);
    grantArea(db, req.user, createArea(db, v.value));
    return reply.redirect('/admin/areas');
  });

  app.post('/admin/areas/:id', (req, reply) => {
    if (!requirePerm(req, reply, 'areas')) return;
    if (!requireCsrf(req, reply)) return;
    const id = Number(req.params.id);
    if (!getArea(db, id)) return reply.code(404).send('Bereich nicht gefunden.');
    if (!canSeeArea(req.user, id)) return forbidden(req, reply);
    const v = validateAreaInput(req.body);
    if (!v.ok) return areasPage(req, reply, v.errors);
    updateArea(db, id, v.value);
    return reply.redirect('/admin/areas');
  });

  app.post('/admin/areas/:id/delete', (req, reply) => {
    if (!requirePerm(req, reply, 'areas')) return;
    if (!requireCsrf(req, reply)) return;
    const id = Number(req.params.id);
    if (!canSeeArea(req.user, id)) return forbidden(req, reply);
    deleteArea(db, id);
    return reply.redirect('/admin/areas');
  });

  function renderSettings(req, reply, { values, errors = [], saved = false, resetDone = false, resetErrors = [] }) {
    return page(req, reply, 'admin-settings', {
      title: 'Einstellungen', values, errors, saved, resetDone, resetErrors,
      resetPhrase: RESET_PHRASE, hasCustomLogo: Boolean(getLogoVersion(db)),
    });
  }

  app.get('/admin/settings', (req, reply) => {
    if (!requirePerm(req, reply, 'settings_view')) return;
    return renderSettings(req, reply, {
      values: getSettings(db), saved: req.query.saved === '1', resetDone: req.query.reset === '1',
    });
  });

  app.post('/admin/reset', (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    if (String(req.body.confirm ?? '').trim().toUpperCase() !== RESET_PHRASE) {
      return renderSettings(req, reply, {
        values: getSettings(db), resetErrors: [`Zum Bestätigen bitte genau „${RESET_PHRASE}" eintippen.`],
      });
    }
    resetAll(db, { includeAreas: Boolean(req.body.include_areas) });
    return reply.redirect('/admin/settings?reset=1');
  });

  app.post('/admin/settings', async (req, reply) => {
    if (!requirePerm(req, reply, 'settings_edit')) return;
    const body = {};
    let file = null;
    if (req.isMultipart()) {
      try {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            const buf = await part.toBuffer();
            if (buf.length) file = buf;
          } else {
            body[part.fieldname] = part.value;
          }
        }
      } catch (err) {
        if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
          return renderSettings(req, reply, { values: getSettings(db), errors: ['Das Logo ist zu groß (max. 2 MB).'] });
        }
        throw err;
      }
    } else {
      Object.assign(body, req.body);
    }
    req.body = body;
    if (!requireCsrf(req, reply)) return;

    const v = validateSettingsInput(body);
    const errors = v.ok ? [] : [...v.errors];
    let mime = null;
    if (file) {
      mime = detectImageMime(file);
      if (!mime) errors.push('Logo muss ein PNG-, JPG-, GIF- oder WebP-Bild sein.');
    }
    if (errors.length) {
      return renderSettings(req, reply, { values: { ...getSettings(db), ...body }, errors });
    }
    saveSettings(db, v.value);
    if (body.remove_logo) clearLogo(db);
    else if (file) setLogo(db, { mime, data: file });
    return reply.redirect('/admin/settings?saved=1');
  });

  // --- Eigenes Passwort ---------------------------------------------------

  const passwordPage = (req, reply, errors = [], saved = false) => page(req, reply, 'admin-password', {
    title: 'Passwort ändern', errors, saved,
  });

  app.get('/admin/password', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    passwordPage(req, reply, [], req.query.saved === '1');
  });

  app.post('/admin/password', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const errors = [];
    if (!verifyPassword(req.body.current ?? '', req.user.password_hash)) errors.push('Aktuelles Passwort ist falsch.');
    const v = validateNewPassword(req.body.password, req.body.password2);
    if (!v.ok) errors.push(...v.errors);
    else if (req.body.password === req.body.current) errors.push('Das neue Passwort muss sich vom alten unterscheiden.');
    if (errors.length) return passwordPage(req, reply, errors);
    setPassword(db, req.user.id, v.value);
    deleteSessionsOfUser(db, req.user.id, req.session.id); // andere Geräte abmelden
    return reply.redirect('/admin/password?saved=1');
  });

  // --- Benutzerverwaltung (nur Hauptadmin) -------------------------------

  const usersPage = (req, reply, { errors = [], values = {}, notice = null } = {}) => page(req, reply, 'admin-users', {
    title: 'Benutzer', users: listUsers(db), areas: listAreas(db), permissions: PERMISSIONS,
    errors, values, notice,
  });

  app.get('/admin/users', (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const notices = { created: 'Account angelegt.', saved: 'Gespeichert.', deleted: 'Account gelöscht.', password: 'Passwort gesetzt – muss beim nächsten Login geändert werden.' };
    usersPage(req, reply, { notice: notices[req.query.ok] ?? null });
  });

  app.post('/admin/users', (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const v = validateUserInput(req.body, { requirePassword: true });
    const errors = v.ok ? [] : [...v.errors];
    if (v.ok && getUserByName(db, v.value.username)) errors.push('Diesen Benutzernamen gibt es schon.');
    if (errors.length) return usersPage(req, reply, { errors, values: req.body });
    createUser(db, { ...v.value, mustChange: true });
    return reply.redirect('/admin/users?ok=created');
  });

  app.post('/admin/users/:id', (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const user = getUser(db, Number(req.params.id));
    if (!user || user.is_owner) return reply.code(404).send('Account nicht gefunden.');
    const v = validateUserInput(req.body, { requirePassword: false });
    const errors = v.ok ? [] : [...v.errors];
    const clash = v.ok && getUserByName(db, v.value.username);
    if (clash && clash.id !== user.id) errors.push('Diesen Benutzernamen gibt es schon.');
    if (errors.length) return usersPage(req, reply, { errors });
    updateUserAccess(db, user.id, v.value);
    return reply.redirect('/admin/users?ok=saved');
  });

  app.post('/admin/users/:id/password', (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const user = getUser(db, Number(req.params.id));
    if (!user || user.is_owner) return reply.code(404).send('Account nicht gefunden.');
    const v = validateNewPassword(req.body.password, req.body.password);
    if (!v.ok) return usersPage(req, reply, { errors: v.errors });
    setPassword(db, user.id, v.value, { mustChange: true });
    deleteSessionsOfUser(db, user.id);
    return reply.redirect('/admin/users?ok=password');
  });

  app.post('/admin/users/:id/delete', (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    deleteUser(db, Number(req.params.id));
    return reply.redirect('/admin/users?ok=deleted');
  });
}
