const assert = require('assert');
const { createChatService } = require('./index');
const { validateChatMessageBody, BODY_MAX } = require('../../lib/chatValidation');

function makeChatDb({ projects = [], messages = [] } = {}) {
  const rows = [...messages];
  let seq = 0;

  return {
    _rows: rows,
    project: {
      findUnique: async ({ where, select }) => {
        const p = projects.find((x) => x.id === where.id) || null;
        if (!p) return null;
        if (!select) return { ...p };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = p[key];
        }
        return out;
      },
    },
    chatMessage: {
      findMany: async ({ where, orderBy, take, include }) => {
        let list = rows.filter((m) => m.projectId === where.projectId);
        if (orderBy?.createdAt === 'asc') {
          list = [...list].sort((a, b) => a.createdAt - b.createdAt);
        }
        if (take) list = list.slice(0, take);
        return list.map((m) => {
          const copy = { ...m };
          if (include?.sender) {
            copy.sender = m.sender || {
              id: m.senderUserId,
              name: 'Sender',
              email: 's@example.com',
              role: 'CLIENT',
            };
          }
          return copy;
        });
      },
      create: async ({ data, include }) => {
        const row = {
          id: `msg-${++seq}`,
          createdAt: new Date(Date.now() + seq),
          ...data,
        };
        if (include?.sender) {
          row.sender = {
            id: data.senderUserId,
            name: data.senderUserId === 'u-client' ? 'Sarah' : 'Rohan',
            email: `${data.senderUserId}@example.com`,
            role: data.senderUserId === 'u-client' ? 'CLIENT' : 'FREELANCER',
          };
        }
        rows.push(row);
        return { ...row };
      },
    },
  };
}

const DEMO_PROJECT = {
  id: 'proj-1',
  clientId: 'u-client',
  freelancerId: 'u-freelancer',
  status: 'ACTIVE',
};

async function testWrongUserRejected() {
  const db = makeChatDb({ projects: [DEMO_PROJECT] });
  const chat = createChatService({ db });

  await assert.rejects(
    () => chat.listMessages({ projectId: 'proj-1', userId: 'u-stranger' }),
    (err) => err.code === 'forbidden' && err.status === 403
  );

  await assert.rejects(
    () =>
      chat.postMessage({
        projectId: 'proj-1',
        userId: 'u-stranger',
        body: { body: 'hello' },
      }),
    (err) => err.code === 'forbidden' && err.status === 403
  );
}

async function testSendAndList() {
  const db = makeChatDb({ projects: [DEMO_PROJECT] });
  const chat = createChatService({ db });

  const posted = await chat.postMessage({
    projectId: 'proj-1',
    userId: 'u-client',
    body: { body: '  Kickoff notes  ' },
  });
  assert.strictEqual(posted.message.body, 'Kickoff notes');
  assert.strictEqual(posted.message.senderUserId, 'u-client');
  assert.ok(posted.message.id);

  await chat.postMessage({
    projectId: 'proj-1',
    userId: 'u-freelancer',
    body: { body: 'Got it — starting Milestone 1' },
  });

  const listed = await chat.listMessages({
    projectId: 'proj-1',
    userId: 'u-freelancer',
  });
  assert.strictEqual(listed.messages.length, 2);
  assert.strictEqual(listed.messages[0].body, 'Kickoff notes');
  assert.strictEqual(listed.messages[1].senderUserId, 'u-freelancer');
}

async function testMissingProject() {
  const db = makeChatDb({ projects: [] });
  const chat = createChatService({ db });
  await assert.rejects(
    () => chat.listMessages({ projectId: 'missing', userId: 'u-client' }),
    (err) => err.code === 'project_not_found' && err.status === 404
  );
}

async function testAllowedAfterCancel() {
  const db = makeChatDb({
    projects: [{ ...DEMO_PROJECT, status: 'CANCELLED_MUTUAL' }],
  });
  const chat = createChatService({ db });
  const posted = await chat.postMessage({
    projectId: 'proj-1',
    userId: 'u-client',
    body: { body: 'Can we resolve the deposit?' },
  });
  assert.strictEqual(posted.message.body, 'Can we resolve the deposit?');
}

function testBodyValidation() {
  assert.ok(validateChatMessageBody({}).errors.includes('body_required'));
  assert.ok(validateChatMessageBody({ body: '   ' }).errors.includes('body_required'));
  assert.ok(
    validateChatMessageBody({ body: 'x'.repeat(BODY_MAX + 1) }).errors.includes('body_too_long')
  );
  const ok = validateChatMessageBody({ body: ' Hello ' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.body, 'Hello');
  const alt = validateChatMessageBody({ message: 'via alias' });
  assert.strictEqual(alt.ok, true);
  assert.strictEqual(alt.body, 'via alias');
}

async function run() {
  testBodyValidation();
  await testWrongUserRejected();
  await testSendAndList();
  await testMissingProject();
  await testAllowedAfterCancel();
  console.log('chat service tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
