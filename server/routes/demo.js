import { Router } from 'express';
import { z } from 'zod';
import { can } from '../auth/middleware.js';
import { parse, forbidden } from '../lib/http.js';
import { seedDemo } from '../db/seed.js';
import { getMeta } from '../db/index.js';
import { runReminders } from '../services/reminders.js';

export function demoRoutes({ db, config }) {
  const r = Router();

  r.get('/status', (_req, res) => {
    res.json({ demoMode: config.demoMode, seededAt: getMeta(db, 'demo_seeded_at'), seedToday: getMeta(db, 'demo_seed_today'), remindersLastRun: getMeta(db, 'reminders_last_run') });
  });

  // Khôi phục toàn bộ dữ liệu demo. Chỉ quản lý, chỉ khi bật chế độ demo, phải gõ xác nhận.
  r.post('/reset', can('demo.reset'), (req, res) => {
    if (!config.demoMode) throw forbidden('Reset chỉ khả dụng trong chế độ demo.');
    parse(z.object({ confirm: z.literal('RESET', { error: 'Gõ RESET để xác nhận.' }) }), req.body);
    seedDemo(db);
    res.json({ ok: true, seededAt: getMeta(db, 'demo_seeded_at') });
  });

  r.post('/run-reminders', can('care.edit'), (_req, res) => res.json({ created: runReminders(db) }));

  return r;
}
