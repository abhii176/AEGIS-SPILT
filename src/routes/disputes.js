const express = require('express');
const { payoutLimiter } = require('../middleware/rateLimit');
const { requireCounselor } = require('../middleware/requireCounselor');
const {
  listDisputes,
  previewDecision,
  decideDispute,
} = require('../controllers/disputeController');

const router = express.Router();

router.use(requireCounselor);

router.get('/', listDisputes);
router.post('/:disputeId/preview', previewDecision);
router.post('/:disputeId/decide', payoutLimiter, decideDispute);

module.exports = router;
