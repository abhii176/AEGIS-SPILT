const express = require('express');
const { githubWebhook } = require('../controllers/githubWebhookController');
const { paypalWebhook } = require('../controllers/paypalWebhookController');
const { webhookLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.use(webhookLimiter);

/** GitHub App / repo webhook — signature verified in controller */
router.post('/github', githubWebhook);

/** PayPal REST webhooks — signature verified via verify-webhook-signature */
router.post('/paypal', paypalWebhook);

module.exports = router;
