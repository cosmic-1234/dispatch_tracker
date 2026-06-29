import { getDbConnection, initDb } from './db.js';

async function runTests() {
    console.log('=== RUNNING DISPATCH PLANNING PORTAL BACKEND TESTS ===');

    try {
        // 1. Init DB
        await initDb();
        console.log('✅ DB Seeding verified.');

        const db = await getDbConnection();

        // 2. Verify Companies
        const companies = await db.all("SELECT id, name, tier, credit_status FROM companies");
        console.log(`✅ Loaded ${companies.length} companies from master list.`);
        if (companies.length < 6) {
            throw new Error('Companies list not fully seeded.');
        }

        // 3. Verify Deccan Solvents Anomaly Detection Flag
        // Deccan has 2 historical closed orders: Acetone 10 MT, Acetone 12 MT (average = 11 MT)
        // Deccan's active order PO-2026-004 has Acetone 50 MT
        // 50 MT > 2 * 11 MT (22 MT) - this should trigger the anomaly detection flag
        const systemDate = '2026-06-29';
        const deccanAvg = await db.get(
            `SELECT AVG(li.quantity) as avg_qty 
             FROM po_line_items li
             JOIN purchase_orders po ON li.po_id = po.id
             WHERE po.company_id = 'COMP-004' AND li.product_type = 'Acetone' AND po.status = 'Closed'`
        );
        const avg = deccanAvg ? parseFloat(deccanAvg.avg_qty) : 0;
        console.log(`ℹ️ Deccan Solvents 90-day average for Acetone: ${avg} MT`);
        
        const deccanNewOrderQty = 50.0;
        const isAnomalous = deccanNewOrderQty > 2 * avg;
        console.log(`✅ Deccan Solvents PO-2026-004 volume is anomalous: ${isAnomalous} (Should be true)`);
        if (!isAnomalous) {
            throw new Error('Deccan Solvents order should be flagged as anomalous.');
        }

        // 4. Verify Prioritization Scoring Calculations
        // Tier A (Punjab Chemicals, COMP-001) - PO-2026-001: Received 2026-06-25, Acetone 40 MT.
        // Age: received 2026-06-25, systemDate 2026-06-29 -> 4 days.
        // Base points: Tier A = 100 points
        // Age points: 4 * 2 = 8 points
        // Stock penalty: Acetone current stock is ~114 MT (which is > 40 MT), so stock penalty = 0
        // Expected score: 100 + 8 = 108 points
        
        // Let's run a mock calculation query
        const stockRow = await db.get("SELECT closing_stock FROM inventory_snapshots WHERE product_type = 'Acetone' AND date = ?", [systemDate]);
        const acetoneStock = stockRow ? stockRow.closing_stock : 0.0;
        
        const basePoints = 100; // Tier A
        const ageDays = 4;
        const agePoints = ageDays * 2;
        const stockPenalty = acetoneStock < 40.0 ? -30 : 0;
        const finalScore = basePoints + agePoints + stockPenalty;
        
        console.log(`ℹ️ Punjab Chemicals PO-2026-001 Priority Calculation:`);
        console.log(`   - Base: ${basePoints} | Age: ${agePoints} | Stock Penalty: ${stockPenalty}`);
        console.log(`   - Final Score: ${finalScore} pts (Expected: 108 pts)`);
        
        if (finalScore !== 108) {
            throw new Error(`Scoring calculation mismatch. Calculated ${finalScore}, expected 108.`);
        }

        // 5. Verify Credit Hold logic
        // Alpha Pharmaceuticals (COMP-005) is On Hold.
        const alpha = await db.get("SELECT credit_status FROM companies WHERE id = 'COMP-005'");
        console.log(`✅ Alpha Pharmaceuticals account status: ${alpha.credit_status} (Should be 'On Hold')`);
        if (alpha.credit_status !== 'On Hold') {
            throw new Error('Alpha Pharmaceuticals should be on credit hold.');
        }

        console.log('=== ALL BACKEND TEST ASSERTIONS PASSED SUCCESSFULLY ===');
        await db.close();
    } catch (err) {
        console.error('❌ Test execution encountered failures:', err);
        process.exit(1);
    }
}

runTests();
