const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

function slicePanel(id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start > 0, id);
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

function buttons(fragment) {
  return fragment.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || [];
}

function label(button) {
  return button.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function testRemovedAndMergedControls() {
  assert.ok(!html.includes('Skip intro'));
  assert.ok(!html.includes('Send sandbox email OTP'));
  assert.ok(!html.includes('Send sandbox SMS OTP'));
  assert.ok(!html.includes('id="btn-stripe-roadmap"'));
  assert.ok(!html.includes('id="btn-refresh-paid"'));
  assert.ok(!html.includes('id="btn-counselor-refresh"'));
  assert.ok(!html.includes('id="btn-simulate"'));
  assert.ok(!html.includes('id="btn-users-next"'));
  assert.ok(!html.includes('id="panel-github"'));
  assert.ok(!html.includes('id="panel-audit"'));
  assert.ok(!html.includes('id="kyc-locker-dialog"'));
  assert.ok(!html.includes('Preview mutual cancel'));
  assert.ok(!html.includes('Back to start'));
  assert.ok(html.includes('Stripe Identity - coming soon'));
  assert.ok(html.includes('Quick verify (judges)'));
  assert.ok(html.includes('Show full DigiLocker flow'));
  assert.ok(html.includes('id="btn-start-demo"'));
  assert.ok(html.includes('id="btn-submit-work"'));
  assert.ok(html.includes('id="panel-work"'));
  assert.ok(html.includes('id="btn-exit-preview"'));
  assert.strictEqual((html.match(/value="123456"/g) || []).length, 3);

  const raise = buttons(html).map(label).filter((text) => text === 'Raise dispute');
  assert.strictEqual(raise.length, 1);

  const verify = buttons(slicePanel('panel-verify')).map(label);
  assert.ok(verify.includes('Quick verify (judges)'));
  assert.ok(verify.includes('Verify email'));
  assert.ok(verify.includes('Verify phone'));
  assert.ok(verify.includes('Verify government ID'));
  assert.ok(verify.includes('Sign agreement'));
  assert.ok(!verify.some((text) => /roadmap/i.test(text)));

  const work = buttons(slicePanel('panel-work')).map(label);
  assert.deepStrictEqual(
    work.filter((text) => text === 'Submit work' || text === 'Approve and pay' || text === 'See payout'),
    ['Submit work', 'Approve and pay', 'See payout']
  );

  const paid = buttons(slicePanel('panel-paid')).map(label);
  assert.deepStrictEqual(paid, ['Cancel or exit']);

  const exit = buttons(slicePanel('panel-exit')).map(label);
  assert.ok(exit.includes('Preview exit'));
  assert.ok(exit.includes('Confirm exit'));
  assert.ok(!exit.includes('Back to fund'));

  const agency = buttons(slicePanel('panel-agency')).map(label);
  assert.deepStrictEqual(agency, ['Load demo agency']);

  const landing = buttons(slicePanel('panel-landing')).map(label);
  assert.deepStrictEqual(landing, ['Start demo']);
}

function run() {
  testRemovedAndMergedControls();
  console.log('demo ui tests passed');
}

run();
