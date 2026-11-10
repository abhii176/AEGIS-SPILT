const { prisma } = require('../lib/prisma');
const { isProjectParticipant } = require('./projectsController');

/**
 * GET /api/projects/:projectId/evidence
 * Read-only pack the two parties already have: chat, audit text, diff preview.
 * There is no separate counselor account, and calls are not recorded.
 */
async function getProjectEvidence(req, res, next) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId },
      include: {
        milestones: { orderBy: { sequence: 'asc' } },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'project_not_found' });
    }
    if (!isProjectParticipant(req.user.id, project)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const [merges, messages] = await Promise.all([
      prisma.mergeEvent.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      prisma.chatMessage.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'asc' },
        take: 50,
        include: { sender: { select: { id: true, name: true, role: true } } },
      }),
    ]);

    return res.status(200).json({
      evidence: {
        platformFeePercent: 0,
        recorded: ['in_app_chat', 'ai_audit_report', 'github_diff_preview'],
        notRecorded: ['voice_calls', 'call_transcripts', 'off_platform_chats'],
        note:
          'This is the in-app chat, the AI audit, and the stored pull-request diff preview. Voice calls and transcripts are not recorded.',
        milestones: project.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          status: m.status,
          amountCents: m.amountCents,
          currency: m.currency,
          acceptanceCriteria: m.acceptanceCriteria,
          auditPassed: m.auditPassed,
          auditReport: m.auditReport,
          requiresManualSignoff: m.requiresManualSignoff,
          manualSignedOffAt: m.manualSignedOffAt,
          githubRepoFullName: m.githubRepoFullName,
          githubPrNumber: m.githubPrNumber,
          githubMergeSha: m.githubMergeSha,
        })),
        merges: merges.map((ev) => ({
          id: ev.id,
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
        messages: messages.map((msg) => ({
          id: msg.id,
          body: msg.body,
          createdAt: msg.createdAt,
          senderUserId: msg.senderUserId,
          senderName: msg.sender?.name || null,
          senderRole: msg.sender?.role || null,
        })),
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getProjectEvidence };
