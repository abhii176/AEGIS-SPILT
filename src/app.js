const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const consentRoutes = require('./routes/consent');
const projectsRoutes = require('./routes/projects');
const vaultRoutes = require('./routes/vault');
const mergeRoutes = require('./routes/merge');
const adminDemoRoutes = require('./routes/adminDemo');
const webhooksRoutes = require('./routes/webhooks');
const notificationsRoutes = require('./routes/notifications');

function createApp() {
  const app = express();
  const publicDir = path.join(__dirname, '..', 'public');

  app.set('trust proxy', true);
  app.use(cors());
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // GitHub webhooks need the raw body for HMAC verification
  app.use(
    '/api/webhooks',
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
    webhooksRoutes
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'aegis-split' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/consent', consentRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/vault', vaultRoutes);
  app.use('/api/merge', mergeRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/admin/demo', adminDemoRoutes);

  // Hackathon demo UI (static) — after API so /api/* stays JSON
  app.use(express.static(publicDir));

  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    res.status(status).json({
      error: err.code || 'internal_error',
      message: err.message || 'Unexpected error',
      ...(err.details ? { details: err.details } : {}),
    });
  });

  return app;
}

module.exports = { createApp };
