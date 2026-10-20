import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import { SqliteSessionStore } from './auth/session-store.js';
import { loadUser, requireAuth, csrfGuard } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { accessGate } from './auth/access-gate.js';
import { errorHandler, HttpError } from './lib/http.js';
import { getMeta, setMeta } from './db/index.js';
import { lookupRoutes } from './routes/lookups.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { leadRoutes } from './routes/leads.js';
import { studentRoutes } from './routes/students.js';
import { enrollmentRoutes } from './routes/enrollments.js';
import { classRoutes } from './routes/classes.js';
import { sessionRoutes } from './routes/sessions.js';
import { financeRoutes } from './routes/finance.js';
import { careRoutes } from './routes/care.js';
import { taskRoutes } from './routes/tasks.js';
import { hrRoutes } from './routes/hr.js';
import { approvalRoutes } from './routes/approvals.js';
import { assetRoutes } from './routes/assets.js';
import { inventoryRoutes } from './routes/inventory.js';
import { noticeRoutes } from './routes/notices.js';
import { reportRoutes } from './routes/reports.js';
import { learningRoutes } from './routes/learning.js';
import { performanceRoutes } from './routes/performance.js';
import { packageRoutes } from './routes/packages.js';
import { closureRoutes, classEventRoutes } from './routes/closures.js';
import { demoRoutes } from './routes/demo.js';

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  let secret = config.sessionSecret;
  if (!secret) {
    secret = getMeta(db, 'session_secret');
    if (!secret) {
      secret = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString('hex');
      setMeta(db, 'session_secret', secret);
    }
  }
  const store = new SqliteSessionStore(db);
  app.locals.sessionStore = store;

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  if (config.accessCode) app.use(accessGate({ code: config.accessCode, secret }));
  // Giới hạn JSON 200 KB; riêng tải file đính kèm đề xuất và nhập học viên từ Excel cho phép lớn hơn
  const jsonSmall = express.json({ limit: '200kb' });
  const jsonLarge = express.json({ limit: '8mb' });
  app.use((req, res, next) => (/^\/api\/(approvals\/\d+\/files|students\/import)$/.test(req.path) ? jsonLarge : jsonSmall)(req, res, next));
  app.use(session({
    name: 'army.sid',
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.secureCookie, maxAge: 1000 * 60 * 60 * 12 },
  }));

  const api = express.Router();
  api.use(csrfGuard);
  api.use(loadUser(db));
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRoutes({ db, config }));
  api.use(requireAuth);
  const ctx = { db, config };
  api.use('/', lookupRoutes(ctx));
  api.use('/dashboard', dashboardRoutes(ctx));
  api.use('/leads', leadRoutes(ctx));
  api.use('/students', studentRoutes(ctx));
  api.use('/enrollments', enrollmentRoutes(ctx));
  api.use('/classes', classRoutes(ctx));
  api.use('/sessions', sessionRoutes(ctx));
  api.use('/finance', financeRoutes(ctx));
  api.use('/care', careRoutes(ctx));
  api.use('/tasks', taskRoutes(ctx));
  api.use('/hr', hrRoutes(ctx));
  api.use('/approvals', approvalRoutes(ctx));
  api.use('/assets', assetRoutes(ctx));
  api.use('/inventory', inventoryRoutes(ctx));
  api.use('/notices', noticeRoutes(ctx));
  api.use('/reports', reportRoutes(ctx));
  api.use('/learning', learningRoutes(ctx));
  api.use('/performance', performanceRoutes(ctx));
  api.use('/packages', packageRoutes(ctx));
  api.use('/closures', closureRoutes(ctx));
  api.use('/class-events', classEventRoutes(ctx));
  api.use('/demo', demoRoutes(ctx));
  api.use((req, _res, next) => next(new HttpError(404, 'Không tìm thấy API.')));
  app.use('/api', api);

  // Bản build: Express phục vụ luôn frontend (cùng origin với API)
  const dist = path.join(config.root, 'client', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
