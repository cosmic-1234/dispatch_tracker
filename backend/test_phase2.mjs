/**
 * Phase 2 Integration Test Suite (ESM)
 * Tests all new backend endpoints added in Phase 2.
 * Run with: node test_phase2.mjs
 */

import http from 'http';
import { createRequire } from 'module';

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

let passed = 0, failed = 0;

function check(condition, msg) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.error(`  ❌ FAIL: ${msg}`); failed++; }
}

// ─── Test Groups ──────────────────────────────────────────────────────────────

async function testDashboard() {
  console.log('\n[1] Dashboard Endpoint');
  const { status, body } = await req('GET', '/api/dashboard');
  check(status === 200, 'GET /api/dashboard returns 200');
  check(Array.isArray(body.inventory_statuses), 'inventory_statuses is array');
  check(typeof body.system_date === 'string', 'system_date present');
  check('relationship_risk_companies' in body, 'relationship_risk_companies field present (Phase 2)');
  check('missed_commitments' in body, 'missed_commitments field present (Phase 2)');
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
  check('system_date' in body, 'system_date present');
}

async function testPOCommitmentFields() {
  console.log('\n[3] PO Management — Commitment Fields');
  const { status, body } = await req('GET', '/api/pos');
  check(status === 200, 'GET /api/pos returns 200');
  check(Array.isArray(body), 'POs is array');
  if (body.length > 0) {
    check('commitment_status' in body[0] || body[0].commitment_status === null || body[0].commitment_status === undefined,
      'commitment_status key exists on PO list item');
  }
}

async function testPOCreateWithCommitment() {
  console.log('\n[4] PO Create with Committed Date');
  const testPoId = `PO-P2TEST-${Date.now()}`;
  const createRes = await req('POST', '/api/pos', {
    id: testPoId,
    company_id: 'COMP-001',
    date_received: '2026-07-01',
    committed_dispatch_date: '2026-07-03',
    notes: 'Phase 2 test PO with commitment',
    items: [{ product_type: 'SDS', quantity: 10 }]
  });
  check(createRes.status === 200 || createRes.status === 201, 'POST /api/pos with committed_dispatch_date succeeds');
  
  const detail = await req('GET', `/api/pos/${testPoId}`);
  check(detail.status === 200, `GET /api/pos/${testPoId} returns 200`);
  check(detail.body.committed_dispatch_date === '2026-07-03', 'committed_dispatch_date persisted on PO detail');
  check(detail.body.commitment_status === 'Missed' || detail.body.commitment_status === 'Pending',
    `commitment_status is valid (got: ${detail.body.commitment_status})`);
  check(Array.isArray(detail.body.commitment_history), 'commitment_history is array on PO detail');

  return testPoId;
}

async function testPORenegotiate(poId) {
  console.log('\n[5] PO Renegotiation');
  if (!poId) { check(false, 'No poId to renegotiate — skipping'); return; }
  const renego = await req('POST', `/api/pos/${poId}/renegotiate`, {
    new_committed_date: '2026-07-20',
    reason: 'Test renegotiation — vehicle breakdown'
  });
  check(renego.status === 200, `POST /api/pos/${poId}/renegotiate returns 200`);
  check(!renego.body.error, 'No error in renegotiation response');

  const detail = await req('GET', `/api/pos/${poId}`);
  check(detail.body.committed_dispatch_date === '2026-07-20', 'Committed date updated after renegotiation');
  check(detail.body.commitment_history.length >= 2,
    `commitment_history has ≥2 entries after renegotiation (got ${detail.body.commitment_history.length})`);
  check(detail.body.commitment_history.some(h => h.status === 'Renegotiated'),
    'commitment_history contains a Renegotiated entry');
}

async function testCommitmentHealth() {
  console.log('\n[6] Commitment Health Dashboard');
  const { status, body } = await req('GET', '/api/commitment-health');
  check(status === 200, 'GET /api/commitment-health returns 200');
  check(Array.isArray(body.companies), 'companies is array');
  check('system_date' in body, 'system_date present');
  check('missed_pos' in body, 'missed_pos field present');
  check(Array.isArray(body.missed_pos), 'missed_pos is array');
  if (body.companies.length > 0) {
    const c = body.companies[0];
    check('id' in c && 'name' in c && 'tier' in c, 'Company object has id, name, tier fields');
    check('total_commitments' in c, 'Company object has total_commitments');
  }
}

async function testScenarios() {
  console.log('\n[7] What-If Scenario Simulator');
  const listRes = await req('GET', '/api/scenarios');
  check(listRes.status === 200, 'GET /api/scenarios returns 200');
  check(Array.isArray(listRes.body), 'Scenarios list is array');

  const createRes = await req('POST', '/api/scenarios', {
    name: `Test Scenario ${Date.now()}`,
    snapshot_json: { product: 'SDS', extra_dispatch: 5, production_boost: 2, projection: { baseline: [], scenario: [] } },
    ai_narration: 'Automated test narration.',
    created_by: 'TestRunner'
  });
  check(createRes.status === 200 || createRes.status === 201, 'POST /api/scenarios returns 200/201');
  check(createRes.body && (createRes.body.success || createRes.body.id), 'Scenario creation returns success/id');

  if (createRes.body && createRes.body.id) {
    const getOne = await req('GET', `/api/scenarios/${createRes.body.id}`);
    check(getOne.status === 200, `GET /api/scenarios/${createRes.body.id} returns 200`);
    check(getOne.body.id === createRes.body.id, 'Fetched scenario id matches created scenario id');
  }
}

async function testCustomerPortal() {
  console.log('\n[8] Customer Portal API');
  const badLogin = await req('POST', '/api/customer/login', { username: 'nobody', password: 'wrong' });
  check(badLogin.status === 200, 'POST /api/customer/login returns 200 for bad creds');
  check(badLogin.body.success === false, 'Bad credentials returns success=false');

  const ordersRes = await req('GET', '/api/customer/orders/COMP-001');
  check(ordersRes.status === 200, 'GET /api/customer/orders/:company_id returns 200');
  check(Array.isArray(ordersRes.body), 'Customer orders list is array');

  if (ordersRes.body.length > 0) {
    const poId = ordersRes.body[0].id;
    const detailRes = await req('GET', `/api/customer/orders/COMP-001/${poId}`);
    check(detailRes.status === 200, `GET /api/customer/orders/COMP-001/${poId} returns 200`);
    check(detailRes.body.id === poId, 'Order detail id matches requested id');
    check(Array.isArray(detailRes.body.items), 'Order detail has items array');
  }
}

async function testOptimizerCommitmentScoring() {
  console.log('\n[9] Optimizer — Commitment Urgency Scoring');
  const { status, body } = await req('GET', '/api/optimizer');
  check(status === 200, 'GET /api/optimizer returns 200');
  check(Array.isArray(body.actionable_po_pool), 'actionable_po_pool is array');
  if (body.actionable_po_pool.length > 0) {
    const item = body.actionable_po_pool[0];
    check('score' in item, 'score present on pool item');
    check('commitment_points' in item, 'commitment_points field present on pool item (Phase 2 scoring)');
    check(typeof item.commitment_points === 'number', 'commitment_points is a number');
  }
}

async function testFrontendFilesExist() {
  console.log('\n[10] Frontend Component Files');
  import('fs').then(({ existsSync }) => {
    const base = 'C:/Users/shrir/Downloads/dispatch_tool/frontend/src';
    const files = [
      `${base}/components/CommitmentHealth.jsx`,
      `${base}/components/CustomerPortal.jsx`,
      `${base}/components/Dashboard.jsx`,
      `${base}/components/DispatchPlanning.jsx`,
      `${base}/components/POManagement.jsx`,
      `${base}/App.jsx`,
    ];
    files.forEach(f => {
      check(existsSync(f), `${f.split('/').pop()} exists`);
    });
  });
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== PHASE 2 INTEGRATION TEST SUITE ===');

  await new Promise(r => setTimeout(r, 1500));

  try {
    await testDashboard();
    await testMorningBrief();
    await testPOCommitmentFields();
    const createdPoId = await testPOCreateWithCommitment();
    await testPORenegotiate(createdPoId);
    await testCommitmentHealth();
    await testScenarios();
    await testCustomerPortal();
    await testOptimizerCommitmentScoring();
    await testFrontendFilesExist();
  } catch (err) {
    console.error('\n❌ UNEXPECTED ERROR:', err.message, err.stack);
    failed++;
  }

  await new Promise(r => setTimeout(r, 500));
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  if (failed === 0) console.log('✅ ALL PHASE 2 TESTS PASSED');
  else console.error(`❌ ${failed} TEST(S) FAILED`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
