import { createDb } from '../src/db.js';
import { buildApp } from '../src/server.js';
import { createArea } from '../src/repositories/areas.js';

export const testConfig = {
  adminUser: 'admin',
  adminPasswordHash: null, // per Test gesetzt
  sessionSecret: 'test-secret',
  baseUrl: 'http://localhost',
  port: 0,
  dbPath: ':memory:',
  secureCookie: false,
};

export async function makeApp(overrides = {}) {
  const db = createDb(':memory:');
  const app = buildApp({ ...testConfig, ...overrides }, db);
  await app.ready();
  return { app, db };
}

export function seedArea(db, overrides = {}) {
  return createArea(db, { name: 'Bar', color: '#888888', sort_order: 0, ...overrides });
}
