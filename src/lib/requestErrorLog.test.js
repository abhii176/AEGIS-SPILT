const assert = require('assert');
const { requestErrorLogRecord, publicErrorBody } = require('./requestErrorLog');

function testP2022MetaIsLoggedAndHiddenFromProductionBody() {
  const err = new Error(
    'The column `exit_events.transferIds` does not exist in the current database.'
  );
  err.code = 'P2022';
  err.status = 500;
  err.meta = { modelName: 'Project', column: 'exit_events.transferIds' };

  const record = requestErrorLogRecord(err, {
    method: 'GET',
    originalUrl: '/api/projects/proj_1',
  });
  assert.strictEqual(record.code, 'P2022');
  assert.strictEqual(record.column, 'exit_events.transferIds');
  assert.strictEqual(record.modelName, 'Project');
  assert.strictEqual(record.path, '/api/projects/proj_1');
  assert.deepStrictEqual(record.meta, err.meta);

  const body = publicErrorBody(err, { isProduction: true, status: 500 });
  assert.strictEqual(body.error, 'P2022');
  assert.strictEqual(body.message, 'Unexpected error');
  assert.strictEqual(body.meta, undefined);
  assert.strictEqual(body.column, undefined);
  assert.ok(!JSON.stringify(body).includes('transferIds'));
  assert.ok(!JSON.stringify(body).includes('exit_events'));
}

function testDevBodyKeepsMessageWithoutMeta() {
  const err = new Error('bad input');
  err.code = 'invalid_amount';
  err.status = 400;
  err.details = { field: 'amountCents' };

  const body = publicErrorBody(err, { isProduction: false, status: 400 });
  assert.strictEqual(body.message, 'bad input');
  assert.deepStrictEqual(body.details, { field: 'amountCents' });
  assert.strictEqual(body.meta, undefined);

  const prod = publicErrorBody(err, { isProduction: true, status: 400 });
  assert.strictEqual(prod.message, 'bad input');
  assert.strictEqual(prod.details, undefined);
}

function testNonPrismaErrorHasNullColumn() {
  const err = new Error('socket hang up');
  const record = requestErrorLogRecord(err, { method: 'POST', url: '/api/vault/fund' });
  assert.strictEqual(record.column, null);
  assert.strictEqual(record.modelName, null);
  assert.strictEqual(record.meta, null);
  assert.strictEqual(record.code, null);
  assert.strictEqual(record.path, '/api/vault/fund');
}

testP2022MetaIsLoggedAndHiddenFromProductionBody();
testDevBodyKeepsMessageWithoutMeta();
testNonPrismaErrorHasNullColumn();
console.log('request error log tests passed');
