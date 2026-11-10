const { prisma } = require('../../lib/prisma');
const { env } = require('../../config/env');
const { createExitService } = require('../exit/exitService');
const { createNotificationService } = require('../notifications');
const {
  remainingVaultCents,
  sumCapturedVaultCents,
  sumPaidOutCents,
  resolveDepositAmountCents,
  sumMilestoneTotalCents,
} = require('../../lib/exitMath');
const {
  DISPUTABLE_MILESTONE_STATUSES,
  assertRaiseAllowed,
  assertDecisionNote,
  buildDisputeMoneyPlan,
  describeDisputeLines,
  decisionTransition,
} = require('../../lib/disputeMath');
const { sampleCallRecording } = require('../../lib/callRecordingPreview');
const {
  isSampleProject,
  assertAgencySampleReadonly,
} = require('../../lib/agencyDashboard');
const {
  ESCROW_NEVER_FUNDED_MESSAGE,
  ESCROW_NOT_READY_NOTE,
  toFriendlyPaypalError,
} = require('../paypal/captureIds');

const OPEN_MILESTONE_FILTER = { notIn: ['PAID', 'RELEASED', 'CANCELLED'] };

/**
 * Raise, review, and settle disputes.
 * Money movement reuses exit-service payout, vault refund, and deposit settlement.
 * PayPal sender batch ids are dispute-scoped so a retry does not pay twice.
 */
function createDisputeService({
  db = prisma,
  exit = createExitService({ db }),
  notifications = createNotificationService({ db }),
} = {}) {
  function idempotencyKeyFor(projectId) {
    return `dispute:${projectId}`;
  }

  async function loadProjectBundle(projectId) {
    const project = await db.project.findUnique({
      where: { id: String(projectId) },
      include: {
        client: true,
        freelancer: true,
        milestones: { orderBy: { sequence: 'asc' } },
        vaultFunds: true,
        freelancerDeposits: { orderBy: { createdAt: 'desc' } },
        disputes: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!project) {
      const err = new Error('Project not found');
      err.status = 404;
      err.code = 'project_not_found';
      throw err;
    }
    return project;
  }

  function assertParticipant(userId, project) {
    if (project.clientId !== userId && project.freelancerId !== userId) {
      const err = new Error('Forbidden');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }
  }

  function vaultSnapshot(project) {
    const captured = sumCapturedVaultCents(project.vaultFunds);
    const paid = sumPaidOutCents(project.milestones);
    return {
      capturedVaultCents: captured,
      paidOutCents: paid,
      remainingVaultCents: remainingVaultCents({
        capturedVaultCents: captured,
        paidOutCents: paid,
      }),
    };
  }

  function heldDepositCents(project) {
    if (project.depositStatus !== 'HELD') return 0;
    const captured = (project.freelancerDeposits || []).find((d) => d.status === 'CAPTURED');
    if (captured) return captured.amountCents;
    return resolveDepositAmountCents({
      freelancerDepositAmountCents: project.freelancerDepositAmountCents,
      milestoneTotalCents: sumMilestoneTotalCents(project.milestones),
    });
  }

  function describeEscrowFunding(project, milestoneId = null) {
    const funds = (project.vaultFunds || []).filter((fund) => {
      if (fund.status !== 'CAPTURED') return false;
      const available = Math.max(
        0,
        (Number(fund.amountCents) || 0) - (Number(fund.refundedCents) || 0)
      );
      if (available <= 0) return false;
      if (milestoneId && fund.milestoneId && fund.milestoneId !== milestoneId) return false;
      return true;
    });
    const ready = funds.some(
      (fund) => fund.paypalCaptureId && fund.paypalCaptureId !== fund.paypalOrderId
    );
    let fundingNote = null;
    if (!funds.length) {
      fundingNote = ESCROW_NOT_READY_NOTE;
    } else if (!ready) {
      fundingNote =
        'This escrow is marked funded, but PayPal has no separate capture id yet. Confirming checks PayPal before any money moves.';
    }
    return {
      captured: funds.length > 0,
      ready,
      fundingNote,
    };
  }

  function planFor(project, input) {
    const snap = vaultSnapshot(project);
    const plan = buildDisputeMoneyPlan({
      decision: input.decision,
      freelancerPercent: input.freelancerPercent,
      remainingVaultCents: snap.remainingVaultCents,
      depositCents: heldDepositCents(project),
      depositHeld: project.depositStatus === 'HELD' && heldDepositCents(project) > 0,
      freelancerAtFault: input.freelancerAtFault,
    });
    return { snap, plan, lines: describeDisputeLines(plan) };
  }

  function publicDispute(dispute, extras = {}) {
    if (!dispute) return null;
    return {
      id: dispute.id,
      projectId: dispute.projectId,
      milestoneId: dispute.milestoneId,
      status: dispute.status,
      reason: dispute.reason,
      decision: dispute.decision,
      freelancerPercent: dispute.freelancerPercent,
      freelancerAtFault: dispute.freelancerAtFault,
      note: dispute.note,
      decidedByUserId: dispute.decidedByUserId,
      decidedByLabel: dispute.decidedByLabel,
      decidedAt: dispute.decidedAt,
      remainingVaultCents: dispute.remainingVaultCents,
      freelancerAmountCents: dispute.freelancerAmountCents,
      clientRefundCents: dispute.clientRefundCents,
      depositCents: dispute.depositCents,
      depositDisposition: dispute.depositDisposition,
      transferIds: dispute.transferIds,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
      ...extras,
    };
  }

  async function raiseDispute({ projectId, userId, reason, milestoneId = null }) {
    const text = String(reason || '').trim();
    if (text.length < 3) {
      const err = new Error('A short reason is required');
      err.status = 400;
      err.code = 'dispute_reason_required';
      throw err;
    }

    const project = await loadProjectBundle(projectId);
    assertAgencySampleReadonly(project);
    assertParticipant(userId, project);

    const open = (project.disputes || []).find((d) => d.status === 'OPEN');
    const milestoneKey = milestoneId ? String(milestoneId) : null;
    assertRaiseAllowed({
      projectStatus: project.status,
      milestones: project.milestones,
      milestoneId: milestoneKey,
      hasOpenDispute: Boolean(open),
    });
    if (!describeEscrowFunding(project, milestoneKey).captured) {
      const err = new Error(
        "This milestone's escrow was never funded through PayPal, so there is nothing to dispute yet."
      );
      err.status = 409;
      err.code = 'escrow_not_captured';
      throw err;
    }

    const key = idempotencyKeyFor(project.id);
    let dispute;
    try {
      dispute = await db.$transaction(async (tx) => {
        const fresh = await tx.project.findUnique({ where: { id: project.id } });
        if (!fresh || fresh.status === 'DISPUTED') {
          return null;
        }
        const created = await tx.dispute.create({
          data: {
            projectId: project.id,
            milestoneId: milestoneKey,
            raisedByUserId: userId,
            reason: text.slice(0, 2000),
            status: 'OPEN',
            idempotencyKey: key,
          },
        });
        await tx.project.update({
          where: { id: project.id },
          data: { status: 'DISPUTED' },
        });
        return created;
      });
    } catch (err) {
      if (err.code === 'P2002') {
        const existing = await db.dispute.findUnique({ where: { idempotencyKey: key } });
        const raced = new Error('This project already has a dispute');
        raced.status = 409;
        raced.code = 'dispute_exists';
        raced.dispute = existing;
        throw raced;
      }
      throw err;
    }

    if (!dispute) {
      const existing = await db.dispute.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
      });
      const err = new Error('This project already has a dispute');
      err.status = 409;
      err.code = 'dispute_exists';
      err.dispute = existing;
      throw err;
    }

    const updated = await db.project.findUnique({
      where: { id: project.id },
      include: { client: true, freelancer: true },
    });
    if (typeof notifications.notifyDisputeOpened === 'function') {
      await notifications.notifyDisputeOpened({
        project: updated,
        dispute,
        raisedByUserId: userId,
      });
    }

    return {
      dispute: publicDispute(dispute),
      projectStatus: 'DISPUTED',
    };
  }

  async function getProjectDispute({ projectId, userId }) {
    const project = await loadProjectBundle(projectId);
    assertParticipant(userId, project);
    const dispute = project.disputes[0] || null;
    return {
      projectStatus: project.status,
      dispute: dispute
        ? publicDispute(dispute, {
            raisedByName:
              dispute.raisedByUserId === project.clientId
                ? project.client?.name || 'Client'
                : project.freelancer?.name || 'Freelancer',
          })
        : null,
    };
  }

  function latestConsent(logs, userId) {
    const rows = (logs || []).filter((row) => row.userId === userId);
    if (!rows.length) return null;
    const latest = rows[rows.length - 1];
    return {
      userId,
      consentVersion: latest.consentVersion,
      agreedAt: latest.agreedAt,
      consentType: latest.consentType,
    };
  }

  async function buildEvidence(project, dispute) {
    const [messages, merges, consents] = await Promise.all([
      db.chatMessage.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: { id: true, name: true, role: true } } },
      }),
      db.mergeEvent.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'asc' },
      }),
      db.consentLogs.findMany({
        where: {
          userId: { in: [project.clientId, project.freelancerId] },
          consentType: 'MONITORING',
        },
        orderBy: { agreedAt: 'asc' },
      }),
    ]);

    const snap = vaultSnapshot(project);
    const focusId = dispute?.milestoneId || null;
    const funding = describeEscrowFunding(project, focusId);

    return {
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        client: {
          id: project.client.id,
          name: project.client.name,
          email: project.client.email,
          role: project.client.role,
        },
        freelancer: {
          id: project.freelancer.id,
          name: project.freelancer.name,
          email: project.freelancer.email,
          role: project.freelancer.role,
        },
      },
      vault: {
        ...snap,
        escrowCaptured: funding.ready,
        fundingNote: funding.fundingNote,
        currency: project.milestones[0]?.currency || env.defaultMilestoneCurrency || 'USD',
      },
      deposit: {
        status: project.depositStatus,
        amountCents: heldDepositCents(project) || resolveDepositAmountCents({
          freelancerDepositAmountCents: project.freelancerDepositAmountCents,
          milestoneTotalCents: sumMilestoneTotalCents(project.milestones),
        }),
        held: project.depositStatus === 'HELD',
      },
      milestones: project.milestones.map((m) => ({
        id: m.id,
        sequence: m.sequence,
        title: m.title,
        taskDescription: m.taskDescription,
        acceptanceCriteria: m.acceptanceCriteria,
        amountCents: m.amountCents,
        currency: m.currency,
        status: m.status,
        focused: focusId ? m.id === focusId : true,
        auditPassed: m.auditPassed,
        auditReport: m.auditReport,
        auditCheckedAt: m.auditCheckedAt,
        requiresManualSignoff: m.requiresManualSignoff,
        manualSignedOffAt: m.manualSignedOffAt,
        githubRepoFullName: m.githubRepoFullName,
        githubPrNumber: m.githubPrNumber,
        githubMergeSha: m.githubMergeSha,
      })),
      messages: messages.map((msg) => ({
        id: msg.id,
        body: msg.body,
        createdAt: msg.createdAt,
        senderUserId: msg.senderUserId,
        senderName: msg.sender?.name || null,
        senderRole: msg.sender?.role || null,
      })),
      audits: project.milestones
        .filter((m) => m.auditPassed != null || m.auditReport)
        .map((m) => ({
          milestoneId: m.id,
          title: m.title,
          passed: m.auditPassed,
          report: m.auditReport,
          checkedAt: m.auditCheckedAt,
        })),
      diffs: merges.map((ev) => ({
        id: ev.id,
        milestoneId: ev.milestoneId,
        repoFullName: ev.repoFullName,
        prNumber: ev.prNumber,
        mergeSha: ev.mergeSha,
        source: ev.source,
        createdAt: ev.createdAt,
        diffPreview:
          ev.metadata && typeof ev.metadata === 'object' && ev.metadata.diffPreview
            ? String(ev.metadata.diffPreview)
            : '',
      })),
      consent: {
        client: latestConsent(consents, project.clientId),
        freelancer: latestConsent(consents, project.freelancerId),
      },
      callRecordings: sampleCallRecording(),
    };
  }

  async function listDisputes({ status = 'OPEN' } = {}) {
    const where = {};
    const normalized = String(status || 'OPEN').toUpperCase();
    if (normalized === 'OPEN' || normalized === 'RESOLVED') {
      where.status = normalized;
    }
    const rows = await db.dispute.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        project: {
          include: {
            client: true,
            freelancer: true,
            milestones: { orderBy: { sequence: 'asc' } },
            vaultFunds: true,
            freelancerDeposits: { orderBy: { createdAt: 'desc' } },
          },
        },
        raisedBy: { select: { id: true, name: true, role: true } },
      },
    });

    const disputes = [];
    for (const row of rows) {
      if (isSampleProject(row.project)) continue;
      const evidence = await buildEvidence(row.project, row);
      disputes.push({
        ...publicDispute(row, {
          raisedByName: row.raisedBy?.name || null,
          projectTitle: row.project.title,
        }),
        evidence,
      });
    }
    return { disputes };
  }

  async function loadOpenDispute(disputeId) {
    const dispute = await db.dispute.findUnique({
      where: { id: String(disputeId) },
    });
    if (!dispute) {
      const err = new Error('Dispute not found');
      err.status = 404;
      err.code = 'dispute_not_found';
      throw err;
    }
    const project = await loadProjectBundle(dispute.projectId);
    return { dispute, project };
  }

  async function previewDecision({ disputeId, decision, freelancerPercent, freelancerAtFault = false }) {
    const { dispute, project } = await loadOpenDispute(disputeId);
    assertAgencySampleReadonly(project);
    if (dispute.status !== 'OPEN') {
      const err = new Error('This dispute is already decided');
      err.status = 409;
      err.code = 'dispute_already_resolved';
      err.dispute = publicDispute(dispute);
      throw err;
    }
    const { snap, plan, lines } = planFor(project, {
      decision,
      freelancerPercent,
      freelancerAtFault,
    });
    decisionTransition({
      projectStatus: project.status,
      disputeStatus: dispute.status,
      plan,
    });
    const funding = describeEscrowFunding(project, dispute.milestoneId);
    if (!funding.ready && funding.fundingNote) {
      lines.push({ to: 'none', label: funding.fundingNote, amountCents: 0 });
    }
    return {
      disputeId: dispute.id,
      vault: snap,
      plan,
      lines,
      escrowCaptured: funding.ready,
      fundingNote: funding.fundingNote,
      requiresNote: true,
    };
  }

  function storedPlan(dispute) {
    return {
      decision: dispute.decision,
      freelancerPercent: dispute.freelancerPercent,
      remainingVaultCents: dispute.remainingVaultCents || 0,
      freelancerAmountCents: dispute.freelancerAmountCents || 0,
      clientRefundCents: dispute.clientRefundCents || 0,
      depositCents: dispute.depositCents || 0,
      depositDisposition: dispute.depositDisposition || 'NONE',
      depositPayoutTo:
        dispute.depositDisposition === 'FORFEITED'
          ? 'client'
          : dispute.depositDisposition === 'RETURNED'
            ? 'freelancer'
            : null,
      freelancerAtFault: dispute.freelancerAtFault,
      projectStatus: dispute.freelancerPercent > 0 ? 'COMPLETED' : 'CANCELLED',
      milestoneStatus: dispute.freelancerPercent === 100 ? 'PAID' : 'CANCELLED',
    };
  }

  function sameDecision(existing, plan, note, atFault) {
    return (
      existing.decision === plan.decision &&
      existing.freelancerPercent === plan.freelancerPercent &&
      existing.freelancerAtFault === atFault &&
      String(existing.note || '') === note
    );
  }

  function refundMovedMoney(vaultRefunds) {
    return (
      Array.isArray(vaultRefunds) &&
      vaultRefunds.some((row) => row && row.refundId && !row.skipped)
    );
  }

  function refundBlockedByMissingCapture(vaultRefunds) {
    if (!Array.isArray(vaultRefunds) || vaultRefunds.length === 0) return false;
    if (refundMovedMoney(vaultRefunds)) return false;
    return vaultRefunds.some(
      (row) =>
        row &&
        (row.skipped ||
          row.reason === 'resource_not_found' ||
          row.reason === 'not_captured' ||
          row.reason === 'escrow_not_funded' ||
          row.note === 'capture_not_found')
    );
  }

  async function settleClaimed({ project, dispute, plan, lines }) {
    // Close the project before PayPal calls, including when a retry resumes a pending decision.
    // Milestone status waits until we know whether a payout actually happened.
    await db.project.update({
      where: { id: project.id },
      data: { status: plan.projectStatus },
    });

    const prior =
      dispute.transferIds && typeof dispute.transferIds === 'object' ? { ...dispute.transferIds } : {};

    let funding;
    try {
      funding =
        typeof exit.assessVaultFunding === 'function'
          ? await exit.assessVaultFunding(project)
          : {
              funded: plan.remainingVaultCents > 0,
              movableCents: plan.remainingVaultCents,
            };
    } catch (err) {
      throw toFriendlyPaypalError(err);
    }

    let escrowFunded = funding.funded;
    let paypalIssue = prior.paypalIssue || null;
    let freelancerPayout = null;
    let vaultRefunds = prior.vaultRefunds || null;

    async function remember(partial) {
      const transferIds = { ...prior, ...partial };
      const updated = await db.dispute.update({
        where: { id: dispute.id },
        data: { transferIds },
      });
      Object.assign(prior, transferIds);
      dispute.transferIds = updated.transferIds;
      return updated;
    }

    if (!vaultRefunds && plan.clientRefundCents > 0) {
      if (!escrowFunded) {
        vaultRefunds = [
          {
            skipped: true,
            reason: 'escrow_not_funded',
            amountCents: plan.clientRefundCents,
          },
        ];
      } else {
        try {
          vaultRefunds = await exit.refundVaultToClient({
            project,
            amountCents: plan.clientRefundCents,
          });
        } catch (err) {
          const friendly = toFriendlyPaypalError(err);
          if (friendly.code === 'escrow_not_funded') {
            escrowFunded = false;
            paypalIssue = 'RESOURCE_NOT_FOUND';
            vaultRefunds = [
              {
                skipped: true,
                reason: 'resource_not_found',
                amountCents: plan.clientRefundCents,
              },
            ];
          } else if (friendly !== err || friendly.code === 'paypal_unavailable') {
            await remember({
              pending: true,
              escrowFunded,
              vaultRefunds: vaultRefunds || null,
              paypalIssue: friendly.paypalIssue || null,
            });
            throw friendly;
          } else {
            throw err;
          }
        }
        if (refundBlockedByMissingCapture(vaultRefunds)) {
          escrowFunded = false;
          paypalIssue = 'RESOURCE_NOT_FOUND';
        }
      }
      await remember({ pending: true, escrowFunded, vaultRefunds, paypalIssue });
    }

    if (plan.freelancerAmountCents > 0) {
      if (prior.freelancerPayoutBatchId) {
        freelancerPayout = {
          payoutBatchId: prior.freelancerPayoutBatchId,
          payoutItemId: prior.freelancerPayoutItemId || null,
          resumed: true,
        };
      } else if (!escrowFunded) {
        freelancerPayout = { skipped: true, reason: 'escrow_not_funded' };
        if (!paypalIssue) paypalIssue = 'RESOURCE_NOT_FOUND';
      } else {
        const email =
          project.freelancer.paypalEmail ||
          env.paypal.payoutEmail ||
          project.freelancer.email;
        const amountCents = Math.min(
          plan.freelancerAmountCents,
          Math.max(0, Number(funding.movableCents) || plan.freelancerAmountCents)
        );
        try {
          freelancerPayout = await exit.payoutAmount({
            email,
            amountCents,
            currency: project.milestones[0]?.currency || env.defaultMilestoneCurrency || 'USD',
            senderBatchId: `dispute-pay-${dispute.id}`,
            senderItemId: `disp-${dispute.id}`,
            note: `Counselor decision: ${project.title}`,
          });
        } catch (err) {
          const friendly = toFriendlyPaypalError(err);
          if (friendly.code === 'escrow_not_funded') {
            escrowFunded = false;
            paypalIssue = 'RESOURCE_NOT_FOUND';
            freelancerPayout = { skipped: true, reason: 'resource_not_found' };
          } else if (friendly !== err || friendly.code === 'paypal_unavailable') {
            await remember({
              pending: true,
              escrowFunded,
              vaultRefunds,
              paypalIssue: friendly.paypalIssue || paypalIssue,
            });
            throw friendly;
          } else {
            throw err;
          }
        }
        if (freelancerPayout?.payoutBatchId) {
          await remember({
            pending: true,
            freelancerPayoutBatchId: freelancerPayout.payoutBatchId,
            freelancerPayoutItemId: freelancerPayout.payoutItemId || null,
          });
        }
      }
    }

    let depositResult = { depositStatus: project.depositStatus, payout: null };
    if (!prior.depositSettled) {
      try {
        depositResult = await exit.settleDeposit({
          project,
          plan: {
            depositDisposition: plan.depositDisposition,
            depositCents: plan.depositCents,
          },
        });
      } catch (err) {
        const friendly = toFriendlyPaypalError(err);
        if (friendly.code === 'escrow_not_funded') {
          paypalIssue = paypalIssue || 'RESOURCE_NOT_FOUND';
          depositResult = {
            depositStatus: project.depositStatus,
            payout: null,
            skipped: true,
            reason: 'resource_not_found',
          };
        } else if (friendly !== err || friendly.code === 'paypal_unavailable') {
          await remember({ pending: true, escrowFunded, vaultRefunds, paypalIssue });
          throw friendly;
        } else {
          throw err;
        }
      }
    } else {
      depositResult = {
        depositStatus: plan.depositDisposition === 'NONE' ? project.depositStatus : plan.depositDisposition,
        payout: prior.depositBatchId
          ? { payoutBatchId: prior.depositBatchId, payoutItemId: prior.depositItemId || null }
          : null,
        alreadySettled: true,
      };
    }

    const moneyMoved = Boolean(
      freelancerPayout?.payoutBatchId ||
        depositResult.payout?.payoutBatchId ||
        refundMovedMoney(vaultRefunds)
    );
    const depositMoved = Boolean(depositResult.payout?.payoutBatchId);
    let notice = null;
    if (!escrowFunded && !moneyMoved) {
      notice = ESCROW_NEVER_FUNDED_MESSAGE;
    } else if (!escrowFunded && depositMoved) {
      notice =
        "This project's escrow was never funded through PayPal, so there is no vault money to release or refund. The security deposit was sent. The decision was recorded.";
    } else if (!escrowFunded && moneyMoved) {
      notice =
        'PayPal could not move every part of this decision. What did go through is saved, and the decision was recorded.';
    }

    const transferIds = {
      pending: false,
      escrowFunded,
      moneyMoved,
      notice,
      paypalIssue: paypalIssue || null,
      freelancerPayoutBatchId:
        freelancerPayout?.payoutBatchId || prior.freelancerPayoutBatchId || null,
      freelancerPayoutItemId:
        freelancerPayout?.payoutItemId || prior.freelancerPayoutItemId || null,
      freelancerPayoutSkipped: Boolean(freelancerPayout?.skipped),
      vaultRefunds,
      depositSettled: true,
      depositSkipped: Boolean(depositResult.skipped),
      depositBatchId: depositResult.payout?.payoutBatchId || prior.depositBatchId || null,
      depositItemId: depositResult.payout?.payoutItemId || prior.depositItemId || null,
      mock: Boolean(freelancerPayout?.raw?.mock || prior.mock),
    };

    const milestoneStatus =
      plan.milestoneStatus === 'PAID' && !freelancerPayout?.payoutBatchId
        ? 'CANCELLED'
        : plan.milestoneStatus;
    const payoutFields =
      milestoneStatus === 'PAID' && freelancerPayout?.payoutBatchId
        ? {
            paypalPayoutBatchId: freelancerPayout.payoutBatchId,
            paypalPayoutItemId: freelancerPayout.payoutItemId || null,
            payoutEmail: project.freelancer.paypalEmail || project.freelancer.email || null,
            releasedAt: new Date(),
          }
        : {};
    await db.milestone.updateMany({
      where: {
        projectId: project.id,
        status: OPEN_MILESTONE_FILTER,
      },
      data: {
        status: milestoneStatus,
        ...payoutFields,
      },
    });

    const updated = await db.dispute.update({
      where: { id: dispute.id },
      data: { transferIds },
    });

    const freshProject = await db.project.findUnique({
      where: { id: project.id },
      include: { client: true, freelancer: true },
    });
    if (typeof notifications.notifyDisputeResolved === 'function') {
      await notifications.notifyDisputeResolved({
        project: freshProject,
        dispute: updated,
        plan,
        notice,
      });
    }

    return {
      alreadyResolved: false,
      dispute: publicDispute(updated),
      plan,
      lines,
      notice,
      moneyMoved,
      transfers: {
        freelancerPayout,
        vaultRefunds,
        deposit: depositResult,
      },
    };
  }

  async function decideDispute({
    disputeId,
    decision,
    freelancerPercent,
    freelancerAtFault = false,
    note,
    decidedByUserId = null,
    decidedByLabel = 'demo-admin-key',
  }) {
    const written = assertDecisionNote(note);
    const { dispute, project } = await loadOpenDispute(disputeId);
    assertAgencySampleReadonly(project);
    const atFault = Boolean(freelancerAtFault);

    if (dispute.status === 'RESOLVED') {
      const requested = planFor(project, {
        decision,
        freelancerPercent,
        freelancerAtFault: atFault,
      }).plan;
      if (!sameDecision(dispute, requested, written, atFault)) {
        const err = new Error('This dispute is already decided');
        err.status = 409;
        err.code = 'dispute_already_resolved';
        throw err;
      }
      const stored = storedPlan(dispute);
      if (dispute.transferIds && dispute.transferIds.pending === true) {
        return settleClaimed({
          project,
          dispute,
          plan: stored,
          lines: describeDisputeLines(stored),
        });
      }
      return {
        alreadyResolved: true,
        dispute: publicDispute(dispute),
        plan: stored,
        lines: describeDisputeLines(stored),
        notice: dispute.transferIds?.notice || null,
        moneyMoved: dispute.transferIds?.moneyMoved !== false,
      };
    }

    const { plan, lines } = planFor(project, {
      decision,
      freelancerPercent,
      freelancerAtFault: atFault,
    });
    decisionTransition({
      projectStatus: project.status,
      disputeStatus: dispute.status,
      plan,
    });

    const claimed = await db.dispute.updateMany({
      where: { id: dispute.id, status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        decision: plan.decision,
        freelancerPercent: plan.freelancerPercent,
        freelancerAtFault: atFault,
        note: written,
        decidedByUserId: decidedByUserId || null,
        decidedByLabel: decidedByLabel ? String(decidedByLabel).slice(0, 200) : null,
        decidedAt: new Date(),
        remainingVaultCents: plan.remainingVaultCents,
        freelancerAmountCents: plan.freelancerAmountCents,
        clientRefundCents: plan.clientRefundCents,
        depositCents: plan.depositCents,
        depositDisposition: plan.depositDisposition,
        transferIds: { pending: true },
      },
    });

    if (claimed.count !== 1) {
      const current = await db.dispute.findUnique({ where: { id: dispute.id } });
      const stored = current ? storedPlan(current) : plan;
      if (current && !sameDecision(current, plan, written, atFault)) {
        const err = new Error('This dispute is already decided');
        err.status = 409;
        err.code = 'dispute_already_resolved';
        throw err;
      }
      if (current?.transferIds && current.transferIds.pending === true) {
        return settleClaimed({
          project,
          dispute: current,
          plan: stored,
          lines: describeDisputeLines(stored),
        });
      }
      return {
        alreadyResolved: true,
        dispute: publicDispute(current),
        plan: stored,
        lines: describeDisputeLines(stored),
        notice: current?.transferIds?.notice || null,
        moneyMoved: current?.transferIds?.moneyMoved !== false,
      };
    }

    const claimedRow = await db.dispute.findUnique({ where: { id: dispute.id } });
    return settleClaimed({
      project,
      dispute: claimedRow,
      plan,
      lines,
    });
  }

  return {
    raiseDispute,
    getProjectDispute,
    listDisputes,
    previewDecision,
    decideDispute,
    buildEvidence,
    planFor,
  };
}

module.exports = { createDisputeService };
