const assert = require('assert');
const fs = require('fs');
const path = require('path');
const panel = require('../../public/agencyPanel');
const { buildAgencyDashboard } = require('./agencyDashboard');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'index.html');

function sampleDashboard() {
  return buildAgencyDashboard({
    users: [
      {
        id: 'rohan',
        email: 'rohan.freelancer@aegis-split.demo',
        name: 'Rohan Mehta',
      },
    ],
    projects: [
      {
        id: 'live-1',
        title: 'Auth service MVP',
        description: 'Real walkthrough project',
        status: 'ACTIVE',
        depositStatus: 'HELD',
        freelancerDepositAmountCents: 2500,
        createdAt: '2026-11-09T00:00:00Z',
        client: { name: 'Sarah Chen' },
        freelancer: { name: 'Rohan Mehta', email: 'rohan.freelancer@aegis-split.demo' },
        milestones: [{ status: 'FUNDED', amountCents: 25000, title: 'Login' }],
        vaultFunds: [{ status: 'CAPTURED', amountCents: 25000, refundedCents: 0 }],
        disputes: [],
      },
      {
        id: 'sample-1',
        title: 'Tournament overlay pack',
        description: 'agency-sample:overlay-pack',
        status: 'ACTIVE',
        depositStatus: 'HELD',
        freelancerDepositAmountCents: 18000,
        createdAt: '2026-11-05T00:00:00Z',
        client: { name: 'Studio Desk (sample)' },
        freelancer: { name: 'Priya Nair', email: 'priya.freelancer@aegis-split.demo' },
        milestones: [{ status: 'FUNDED', amountCents: 180000, title: 'Scorebug' }],
        vaultFunds: [{ status: 'CAPTURED', amountCents: 180000, refundedCents: 0 }],
        freelancerDeposits: [{ status: 'CAPTURED', amountCents: 18000 }],
        disputes: [
          {
            id: 'd-sample',
            status: 'OPEN',
            reason: 'Sample dispute',
            createdAt: '2026-11-08T00:00:00Z',
          },
        ],
      },
    ],
  });
}

function testTableIsReadOnlyAndSplit() {
  const html = panel.render(sampleDashboard());
  assert.ok(html.includes('<table'));
  assert.strictEqual((html.match(/<table/g) || []).length, 1);
  assert.ok(html.includes('data-source="live"'));
  assert.ok(html.includes('data-source="sample"'));
  assert.ok(html.includes('Auth service MVP'));
  assert.ok(html.includes('Tournament overlay pack'));
  assert.ok(html.includes('>$250.00<'));
  assert.ok(html.includes('>$1,800.00<'));
  assert.ok(html.includes('Held in escrow'));
  assert.ok(html.includes('Live $250.00'));
  assert.ok(html.includes('Sample $1,800.00'));
  assert.ok(html.includes('deposit $180.00 at risk'));
  assert.ok(html.includes('dispute open'));
  assert.ok(html.includes('Team workload'));
  assert.ok(html.includes('Rohan Mehta'));
  assert.ok(html.includes('Priya Nair'));
  assert.ok(html.includes('Recent activity'));
  assert.ok(!html.includes('<button'));
  assert.ok(!html.includes('<input'));
  assert.ok(!html.includes('brand-mark'));
}

function testPageHasOneLoadButtonAndStaticNote() {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const panelStart = html.indexOf('id="panel-agency"');
  const panelEnd = html.indexOf('</section>', panelStart);
  const agency = html.slice(panelStart, panelEnd);
  assert.ok(panelStart > 0);
  assert.ok(
    agency.includes(
      'Agency dashboard - preview. Sample data for demo; white-label and multi-seat billing are on the roadmap.'
    )
  );
  assert.ok(agency.includes('White-label: coming soon.'));
  assert.ok(agency.includes('id="btn-load-agency"'));
  assert.ok(agency.includes('Load demo agency'));
  assert.strictEqual((agency.match(/<button/g) || []).length, 1);
  assert.ok(!agency.includes('<input'));
  assert.ok(!agency.includes('type="color"'));
  assert.ok(!html.includes('data-seed-agency'));
  assert.ok(!html.includes('Agency preview</button>'));
  const users = html.slice(html.indexOf('id="panel-users"'), html.indexOf('id="panel-verify"'));
  assert.ok(!users.includes('agency'));
}

function run() {
  testTableIsReadOnlyAndSplit();
  testPageHasOneLoadButtonAndStaticNote();
  console.log('agency panel view tests passed');
}

run();
