const express = require('express');
const { githubWebhook } = require('../controllers/githubWebhookController');

const router = express.Router();

/** GitHub App / repo webhook — signature verified in controller */
router.post('/github', githubWebhook);

module.exports = router;
