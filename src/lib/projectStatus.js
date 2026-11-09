const { isCancelledStatus, CANCELLED_STATUSES } = require('./exitMath');

function assertProjectNotCancelled(project, action = 'this action') {
  if (isCancelledStatus(project?.status)) {
    const err = new Error(`Project is ${project.status}; ${action} is blocked`);
    err.status = 409;
    err.code = 'project_cancelled';
    err.details = { status: project.status };
    throw err;
  }
  return project;
}

module.exports = {
  assertProjectNotCancelled,
  isCancelledStatus,
  CANCELLED_STATUSES,
};
