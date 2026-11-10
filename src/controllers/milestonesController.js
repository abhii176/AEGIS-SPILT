const { prisma } = require('../lib/prisma');
const { env } = require('../config/env');
const { isProjectParticipant } = require('./projectsController');
const { validateAddMilestoneBody } = require('../lib/projectValidation');
const { assertProjectNotCancelled } = require('../lib/projectStatus');

async function loadProjectOrFail(projectId, userId) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    err.code = 'project_not_found';
    throw err;
  }
  if (!isProjectParticipant(userId, project)) {
    const err = new Error('Forbidden');
    err.status = 403;
    err.code = 'forbidden';
    throw err;
  }
  return project;
}

/**
 * POST /api/projects/:projectId/milestones
 * Add a milestone (task, acceptance criteria, amount). Auth + project membership.
 * Create-project / fund remain the primary KYC gates; adding milestones also
 * requires KYC+consent so both parties are verified before agreeing on money.
 */
async function addMilestone(req, res, next) {
  try {
    const { projectId } = req.params;
    const project = await loadProjectOrFail(projectId, req.user.id);
    assertProjectNotCancelled(project, 'adding milestones');

    const {
      title,
      taskDescription,
      task_description: taskDescriptionSnake,
      acceptanceCriteria,
      acceptance_criteria: acceptanceCriteriaSnake,
      amountCents,
      amount_cents: amountCentsSnake,
      currency,
      sequence,
      githubRepoFullName,
      github_repo_full_name: githubRepoSnake,
      githubPrNumber,
      github_pr_number: githubPrNumberSnake,
      githubPrUrl,
      github_pr_url: githubPrUrlSnake,
    } = req.body || {};

    const validation = validateAddMilestoneBody(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({ error: validation.errors[0] });
    }

    const task = taskDescription || taskDescriptionSnake;
    const criteria = acceptanceCriteria || acceptanceCriteriaSnake;
    const amount = validation.amountCents;

    let nextSequence = sequence != null ? Number(sequence) : null;
    if (nextSequence != null && (!Number.isInteger(nextSequence) || nextSequence < 1)) {
      return res.status(400).json({ error: 'invalid_sequence' });
    }

    if (nextSequence == null) {
      const agg = await prisma.milestone.aggregate({
        where: { projectId },
        _max: { sequence: true },
      });
      nextSequence = (agg._max.sequence || 0) + 1;
    }

    const milestone = await prisma.milestone.create({
      data: {
        projectId,
        sequence: nextSequence,
        title: title.trim(),
        taskDescription: String(task).trim(),
        acceptanceCriteria: String(criteria).trim(),
        amountCents: amount,
        requiresManualSignoff: validation.requiresManualSignoff === true,
        currency: String(currency || env.defaultMilestoneCurrency || 'USD').toUpperCase(),
        githubRepoFullName: githubRepoFullName || githubRepoSnake || null,
        githubPrNumber:
          githubPrNumber != null || githubPrNumberSnake != null
            ? Number(githubPrNumber ?? githubPrNumberSnake)
            : null,
        githubPrUrl: githubPrUrl || githubPrUrlSnake || null,
      },
    });

    // Promote DRAFT → ACTIVE once the first milestone is agreed
    await prisma.project.updateMany({
      where: { id: projectId, status: 'DRAFT' },
      data: { status: 'ACTIVE' },
    });

    return res.status(201).json({ milestone });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'sequence_conflict',
        message: 'A milestone with this sequence already exists on the project.',
      });
    }
    return next(err);
  }
}

/**
 * GET /api/projects/:projectId/milestones
 */
async function listMilestones(req, res, next) {
  try {
    const { projectId } = req.params;
    await loadProjectOrFail(projectId, req.user.id);

    const milestones = await prisma.milestone.findMany({
      where: { projectId },
      orderBy: { sequence: 'asc' },
    });

    return res.status(200).json({ milestones });
  } catch (err) {
    return next(err);
  }
}

module.exports = { addMilestone, listMilestones, loadProjectOrFail };
