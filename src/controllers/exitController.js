const { createExitService } = require('../services/exit/exitService');
const { createDepositService } = require('../services/exit/depositService');
const { env } = require('../config/env');

const exitService = createExitService();
const depositService = createDepositService();

/** GET /api/projects/:projectId/exit/preview?path=MUTUAL|CLIENT_ONESIDED|FREELANCER_WALKAWAY */
async function previewExit(req, res, next) {
  try {
    const result = await exitService.getExitPreview({
      projectId: req.params.projectId,
      userId: req.user.id,
      exitPath: req.query.path || req.query.exitPath || 'MUTUAL',
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/** POST /api/projects/:projectId/cancel/request  { reason? } */
async function requestCancel(req, res, next) {
  try {
    const result = await exitService.requestCancellation({
      projectId: req.params.projectId,
      userId: req.user.id,
      reason: req.body?.reason || null,
    });
    return res.status(result.created ? 201 : 200).json({
      cancellationRequest: result.cancellationRequest,
      created: result.created,
      preview: result.preview,
      note: 'Waiting for the other party to accept. Money moves only after accept.',
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/projects/:projectId/cancel/accept  { cancellationRequestId?, reason? } */
async function acceptCancel(req, res, next) {
  try {
    const result = await exitService.acceptCancellation({
      projectId: req.params.projectId,
      userId: req.user.id,
      cancellationRequestId: req.body?.cancellationRequestId || null,
      reason: req.body?.reason || null,
    });
    return res.status(200).json({
      ...result,
      note: result.alreadyExited
        ? 'Exit already recorded (idempotent).'
        : 'Mutual cancel complete — vault refunded, deposit returned, no penalty.',
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/projects/:projectId/exit/client  { reason? } — client one-sided */
async function clientExit(req, res, next) {
  try {
    const result = await exitService.clientOnesidedCancel({
      projectId: req.params.projectId,
      userId: req.user.id,
      reason: req.body?.reason || null,
    });
    return res.status(200).json({
      ...result,
      note: result.alreadyExited
        ? 'Exit already recorded (idempotent).'
        : 'Client one-sided cancel — penalty paid to freelancer, rest refunded, deposit returned.',
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/projects/:projectId/exit/abandon  { reason? } — freelancer walk-away */
async function freelancerAbandon(req, res, next) {
  try {
    const result = await exitService.freelancerWalkAway({
      projectId: req.params.projectId,
      userId: req.user.id,
      reason: req.body?.reason || null,
    });
    return res.status(200).json({
      ...result,
      note: result.alreadyExited
        ? 'Exit already recorded (idempotent).'
        : 'Freelancer walk-away — deposit forfeited to client, vault refunded 100%.',
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/projects/:projectId/deposit/fund */
async function fundDeposit(req, res, next) {
  try {
    let autoCapture = env.paypal.autoCapture;
    const parseBool = (v) => v === true || v === 'true' || v === 1 || v === '1';
    if (req.body?.capture != null) autoCapture = parseBool(req.body.capture);
    else if (req.body?.autoCapture != null) autoCapture = parseBool(req.body.autoCapture);

    const result = await depositService.fundDeposit({
      userId: req.user.id,
      projectId: req.params.projectId,
      autoCapture,
    });

    return res.status(201).json({
      deposit: result.deposit,
      project: result.project,
      paypal: result.paypal,
      approveUrl: result.paypal.approvalUrl,
      note: result.paypal.autoCapture
        ? 'Deposit order created and captured — security deposit held.'
        : 'Deposit order created — redirect freelancer to approvalUrl, then capture on return.',
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/projects/:projectId/deposit/capture */
async function captureDeposit(req, res, next) {
  try {
    const result = await depositService.captureDeposit({
      userId: req.user.id,
      depositId: req.body?.depositId || null,
      orderId: req.body?.orderId || req.body?.token || null,
      requireApproved: true,
    });
    return res.status(200).json({
      deposit: result.deposit,
      alreadyCaptured: result.alreadyCaptured,
      paypal: result.paypal || null,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  previewExit,
  requestCancel,
  acceptCancel,
  clientExit,
  freelancerAbandon,
  fundDeposit,
  captureDeposit,
  exitService,
  depositService,
};
