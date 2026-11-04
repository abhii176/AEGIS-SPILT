const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { requireKycAndConsent } = require('../middleware/requireKycAndConsent');
const { createProject } = require('../controllers/projectsController');

const router = express.Router();

/** Creating a project requires gov_id_verified AND monitoring_consent_granted */
router.post('/', requireAuth, requireKycAndConsent, createProject);

module.exports = router;
