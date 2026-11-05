const assert = require('assert');
const { createNotificationService, TYPES } = require('./index');

function makeNotificationDb() {
  const rows = [];
  let seq = 0;

  return {
    _rows: rows,
    notification: {
      findFirst: async ({ where }) => {
        return (
          rows.find((n) => {
            if (where.userId && n.userId !== where.userId) return false;
            if (where.dedupeKey != null && n.dedupeKey !== where.dedupeKey) return false;
            if (where.readAt === null && n.readAt != null) return false;
            return true;
          }) || null
        );
      },
      findMany: async ({ where, orderBy, take }) => {
        let list = rows.filter((n) => {
          if (where.userId && n.userId !== where.userId) return false;
          if (where.readAt === null && n.readAt != null) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          list = [...list].sort((a, b) => b.createdAt - a.createdAt);
        }
        if (take) list = list.slice(0, take);
        return list.map((n) => ({ ...n }));
      },
      count: async ({ where }) =>
        rows.filter((n) => {
          if (where.userId && n.userId !== where.userId) return false;
          if (where.readAt === null && n.readAt != null) return false;
          return true;
        }).length,
      create: async ({ data }) => {
        const row = {
          id: `n-${++seq}`,
          readAt: null,
          createdAt: new Date(Date.now() + seq),
          projectId: null,
          milestoneId: null,
          dedupeKey: null,
          ...data,
        };
        rows.push(row);
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const n of rows) {
          if (where.userId && n.userId !== where.userId) continue;
          if (where.readAt === null && n.readAt != null) continue;
          if (where.id?.in && !where.id.in.includes(n.id)) continue;
          Object.assign(n, data);
          count += 1;
        }
        return { count };
      },
    },
  };
}

async function testCreateAndList() {
  const db = makeNotificationDb();
  const svc = createNotificationService({ db });

  const created = await svc.createNotification({
    userId: 'u-sarah',
    type: TYPES.FUNDED,
    message: 'Vault funded: $250.00 locked for “Milestone 1”.',
    projectId: 'proj-1',
    milestoneId: 'ms-1',
    dedupeKey: 'FUNDED:ms-1:u-sarah',
  });
  assert.strictEqual(created.created, true);
  assert.strictEqual(created.notification.type, 'FUNDED');
  assert.ok(created.notification.id);

  const listed = await svc.listForUser({ userId: 'u-sarah' });
  assert.strictEqual(listed.notifications.length, 1);
  assert.strictEqual(listed.unreadCount, 1);
  assert.strictEqual(listed.notifications[0].message.includes('Vault funded'), true);

  const other = await svc.listForUser({ userId: 'u-rohan' });
  assert.strictEqual(other.notifications.length, 0);
  assert.strictEqual(other.unreadCount, 0);
}

async function testIdempotentDedupe() {
  const db = makeNotificationDb();
  const svc = createNotificationService({ db });

  const first = await svc.createNotification({
    userId: 'u-1',
    type: TYPES.PAID,
    message: 'Paid: $250.00 released for “M1”.',
    milestoneId: 'ms-1',
    dedupeKey: 'PAID:ms-1:u-1',
  });
  const second = await svc.createNotification({
    userId: 'u-1',
    type: TYPES.PAID,
    message: 'Paid: $250.00 released for “M1”.',
    milestoneId: 'ms-1',
    dedupeKey: 'PAID:ms-1:u-1',
  });

  assert.strictEqual(first.created, true);
  assert.strictEqual(second.created, false);
  assert.strictEqual(first.notification.id, second.notification.id);
  assert.strictEqual(db._rows.length, 1);
}

async function testNotifyProjectPartiesAndMarkRead() {
  const db = makeNotificationDb();
  const svc = createNotificationService({ db });

  const project = {
    id: 'proj-1',
    clientId: 'u-sarah',
    freelancerId: 'u-rohan',
    title: 'Auth service',
  };
  const milestone = {
    id: 'ms-1',
    title: 'Milestone 1',
    amountCents: 25000,
  };

  const funded = await svc.notifyFunded({
    project,
    milestone,
    amountCents: 25000,
  });
  assert.strictEqual(funded.created.length, 2);
  assert.strictEqual(funded.skipped.length, 0);

  const again = await svc.notifyFunded({
    project,
    milestone,
    amountCents: 25000,
  });
  assert.strictEqual(again.created.length, 0);
  assert.strictEqual(again.skipped.length, 2);

  const audit = await svc.notifyAudit({
    project,
    milestone,
    passed: true,
    reason: 'criteria met',
  });
  assert.strictEqual(audit.created.length, 2);
  assert.ok(audit.created.every((n) => n.type === TYPES.AUDIT_PASSED));

  const paid = await svc.notifyPaid({ project, milestone });
  assert.strictEqual(paid.created.length, 2);

  const sarahList = await svc.listForUser({ userId: 'u-sarah' });
  assert.strictEqual(sarahList.notifications.length, 3);
  assert.strictEqual(sarahList.unreadCount, 3);

  const marked = await svc.markRead({
    userId: 'u-sarah',
    notificationIds: [sarahList.notifications[0].id],
  });
  assert.strictEqual(marked.updated, 1);

  const afterOne = await svc.listForUser({ userId: 'u-sarah' });
  assert.strictEqual(afterOne.unreadCount, 2);

  const markAll = await svc.markRead({ userId: 'u-sarah', all: true });
  assert.strictEqual(markAll.updated, 2);

  const afterAll = await svc.listForUser({ userId: 'u-sarah', unreadOnly: true });
  assert.strictEqual(afterAll.notifications.length, 0);
  assert.strictEqual(afterAll.unreadCount, 0);
}

async function testRejectsInvalidCreate() {
  const db = makeNotificationDb();
  const svc = createNotificationService({ db });
  await assert.rejects(
    () => svc.createNotification({ userId: '', type: 'FUNDED', message: 'x' }),
    (err) => err.code === 'invalid_notification'
  );
}

async function run() {
  await testCreateAndList();
  await testIdempotentDedupe();
  await testNotifyProjectPartiesAndMarkRead();
  await testRejectsInvalidCreate();
  console.log('notifications create/list tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
