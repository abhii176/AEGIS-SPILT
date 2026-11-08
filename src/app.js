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
    // Surface PayPal mock/mode (no secrets) so hosts can confirm live sandbox vs MOCK-ORDER.
    const { env } = require('./config/env');
    const { createPaypalClient } = require('./services/paypal/client');
    const paypalClient = createPaypalClient();
    const cid = String(env.paypal.clientId || '').trim();
    const csec = String(env.paypal.clientSecret || '').trim();
    const looksPlaceholder = (v) =>
      !v || v.toLowerCase().startsWith('your_') || v.toLowerCase().includes('placeholder');
    res.json({
      ok: true,
      service: 'aegis-split',
      paypal: {
        mock: paypalClient.isMock(),
        mockFlag: env.paypal.mock,
        mode: env.paypal.mode,
        autoCapture: env.paypal.autoCapture,
        clientIdConfigured: Boolean(cid) && !looksPlaceholder(cid),
        clientSecretConfigured: Boolean(csec) && !looksPlaceholder(csec),
        appBaseUrl: env.appBaseUrl,
      },
    });
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
    const isProduction = process.env.NODE_ENV === 'production';
    const message =
      isProduction && status >= 500
        ? 'Unexpected error'
        : err.message || 'Unexpected error';
    res.status(status).json({
      error: err.code || 'internal_error',
      message,
      ...(!isProduction && err.details ? { details: err.details } : {}),
    });
  });

  return app;
}

module.exports = { createApp };
