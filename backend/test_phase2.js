/**
 * Phase 2 Integration Test Suite
 * Tests all new backend endpoints added in Phase 2.
 * Run with: node test_phase2.js
 */

const http = require('http');
const assert = require('assert');

let server;
const BASE = 'http://localhost:5000';

// ─── Helpers ────────────────────────────────────────────────────────────────

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost', port: 5000, path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function pass(msg) { console.log(`  \u2705 ${msg}`); }
function fail(msg) { console.error(`  \u274c FAIL: ${msg}`); process.exitCode = 1; }

function check(condition, msg) {
  if (condition) pass(msg);
  else fail(msg);
}

// ─── Test Groups ──────────────────────────────────────────────────────────────

async function testDashboard() {
  console.log('\n[1] Dashboard Endpoint');
  const { status, body } = await req('GET', '/api/dashboard');
  check(status === 200, 'GET /api/dashboard returns 200');
  check(Array.isArray(body.inventory_statuses), 'inventory_statuses is array');
  check(typeof body.system_date === 'string', 'system_date present');
  // New Phase 2 fields
  check('relationship_risk_companies' in body, 'relationship_risk_companies field present');
  check('missed_commitments' in body, 'missed_commitments field present');
  check(Array.isArray(body.relationship_risk_companies), 'relationship_risk_companies is array');
  check(Array.isArray(body.missed_commitments), 'missed_commitments is array');
}

async function testMorningBrief() {
  console.log('\n[2] Morning Brief Endpoint');
  const { status, body } = await req('GET', '/api/dashboard/morning-brief');
  check(status === 200, 'GET /api/dashboard/morning-brief returns 200');
  check(Array.isArray(body.missed_commitments), 'missed_commitments is array');
  check(Array.isArray(body.relationship_risk_companies), 'relationship_risk_companies is array');
  check(Array.isArray(body.shortage_alerts), 'shortage_alerts is array');
}

async function testPOCommitmentFields() {
  console.log('\n[3] PO Management — Commitment Fields');
  const { status, body } = await req('GET', '/api/pos');
  check(status === 200, 'GET /api/pos returns 200');
  check(Array.isArray(body), 'POs is array');
  if (body.length > 0) {
    const po = body[0];
    check('commitment_status' in po || po.commitment_status === null, 'commitment_status field present on PO list');
  }
}

async function testPORenegotiate() {
  console.log('\n[4] PO Renegotiate Endpoint');
  // First get a PO that has a committed date, or create one
  const { body: pos } = await req('GET', '/api/pos');
  
  // Try POST first to create a test PO with commitment
  const createRes = await req('POST', '/api/pos', {
    id: `PO-TEST-COMMIT-${Date.now()}`,
    company_id: 1,
    date_received: '2026-07-01',
    committed_dispatch_date: '2026-07-03',
    notes: 'Phase 2 test PO',
    items: [{ product_type: 'Acetone', quantity: 10 }]
  });
  check(createRes.status === 200 || createRes.status === 201, 'POST /api/pos with committed_dispatch_date succeeds');
  
  if (createRes.body && createRes.body.id) {
    const poId = createRes.body.id;
    const renego = await req('POST', `/api/pos/${poId}/renegotiate`, {
      new_committed_date: '2026-07-10',
      reason: 'Test renegotiation — vehicle unavailable'
    });
    check(renego.status === 200, `POST /api/pos/${poId}/renegotiate returns 200`);
    check(renego.body && !renego.body.error, 'Renegotiation response has no error');

    // Verify history was written
    const detail = await req('GET', `/api/pos/${poId}`);
    check(detail.status === 200, `GET /api/pos/${poId} returns 200`);
    check(detail.body.committed_dispatch_date === '2026-07-10', 'Committed date updated after renegotiation');
    check(Array.isArray(detail.body.commitment_history), 'commitment_history is array');
    check(detail.body.commitment_history.length > 0, 'commitment_history has at least 1 entry');
  }
}

async function testCommitmentHealth() {
  console.log('\n[5] Commitment Health Dashboard');
  const { status, body } = await req('GET', '/api/commitment-health');
  check(status === 200, 'GET /api/commitment-health returns 200');
  check(Array.isArray(body.companies), 'companies is array');
  check('system_date' in body, 'system_date present');
  if (body.companies.length > 0) {
    const c = body.companies[0];
    check('id' in c, 'company.id present');
    check('name' in c, 'company.name present');
    check('tier' in c, 'company.tier present');
  }
}

async function testScenarios() {
  console.log('\n[6] What-If Scenario Simulator');
  // GET scenarios list
  const { status: getStatus, body: getBody } = await req('GET', '/api/scenarios');
  check(getStatus === 200, 'GET /api/scenarios returns 200');
  check(Array.isArray(getBody), 'Scenarios list is array');

  // POST create scenario
  const createRes = await req('POST', '/api/scenarios', {
    name: 'Test Scenario — Acetone High Demand',
    snapshot_json: { product: 'Acetone', extra_dispatch: 5, production_boost: 2, projection: { baseline: [], scenario: [] } },
    ai_narration: 'Test narration from automated test suite.',
    created_by: 'TestRunner'
  });
  check(createRes.status === 200 || createRes.status === 201, 'POST /api/scenarios returns 200/201');
  check(createRes.body.success || createRes.body.id, 'Scenario creation returns success or id');

  // GET specific scenario if id returned
  if (createRes.body.id) {
    const { status: s2, body: b2 } = await req('GET', `/api/scenarios/${createRes.body.id}`);
    check(s2 === 200, `GET /api/scenarios/${createRes.body.id} returns 200`);
    check(b2.name === 'Test Scenario — Acetone High Demand', 'Scenario name matches');
  }
}

async function testCustomerPortal() {
  console.log('\n[7] Customer Portal API');
  // Test login with wrong creds
  const badLogin = await req('POST', '/api/customer/login', { username: 'nobody', password: 'wrong' });
  check(badLogin.status === 200, 'POST /api/customer/login returns 200 for bad creds');
  check(badLogin.body.success === false, 'Bad credentials returns success=false');

  // Test orders endpoint (with company_id 1)
  const ordersRes = await req('GET', '/api/customer/orders/1');
  check(ordersRes.status === 200, 'GET /api/customer/orders/:company_id returns 200');
  check(Array.isArray(ordersRes.body), 'Customer orders list is array');
}

async function testOptimizerCommitmentScoring() {
  console.log('\n[8] Optimizer — Commitment Urgency Scoring');
  const { status, body } = await req('GET', '/api/optimizer');
  check(status === 200, 'GET /api/optimizer returns 200');
  check(Array.isArray(body.actionable_po_pool), 'actionable_po_pool is array');
  if (body.actionable_po_pool.length > 0) {
    const item = body.actionable_po_pool[0];
    check('score' in item, 'score present on pool item');
    check('commitment_points' in item, 'commitment_points field present on pool item (Phase 2)');
  }
}

// ─── Run All Tests ────────────────────────────────────────────────────────────

async function main() {
  console.log('=== PHASE 2 INTEGRATION TEST SUITE ===');
  
  // Start server
  server = require('./server.js');
  await new Promise(r => setTimeout(r, 2000));

  try {
    await testDashboard();
    await testMorningBrief();
    await testPOCommitmentFields();
    await testPORenegotiate();
    await testCommitmentHealth();
    await testScenarios();
    await testCustomerPortal();
    await testOptimizerCommitmentScoring();
  } catch (err) {
    console.error('\n\u274c UNEXPECTED ERROR:', err.message);
    process.exitCode = 1;
  }

  const code = process.exitCode || 0;
  console.log(`\n=== RESULT: ${code === 0 ? '\u2705 ALL PHASE 2 TESTS PASSED' : '\u274c SOME TESTS FAILED'} ===`);
  process.exit(code);
}

main();
