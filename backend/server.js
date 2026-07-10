import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { 
    queryAll, 
    queryGet, 
    queryRun, 
    runInTransaction, 
    initDb 
} from './db.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Database on startup
initDb().then(() => {
    console.log('Database initialized successfully.');
}).catch(err => {
    console.error('Failed to initialize database:', err);
});

// Helper: Get active simulated date or actual date
async function getSystemDate() {
    const row = await queryGet("SELECT value FROM system_settings WHERE key = 'system_date'");
    return row ? row.value : '2026-06-29';
}

// Helper: Sync PO Commitment Statuses and Company Health Scores based on simulated date
async function syncPOCommitmentStatuses(systemDate) {
    try {
        const pos = await queryAll(
            `SELECT id, status, committed_dispatch_date, commitment_status 
             FROM purchase_orders 
             WHERE committed_dispatch_date IS NOT NULL`
        );

        for (const po of pos) {
            const dispatches = await queryAll(
                `SELECT dl.actual_dispatch_date, dl.status as dispatch_status
                 FROM dispatch_allocations da
                 JOIN dispatch_log dl ON da.dispatch_id = dl.id
                 WHERE da.po_id = ?`,
                [po.id]
            );

            const isFullyDispatched = po.status === 'Dispatched' || po.status === 'Closed';
            const actualDispatchDates = dispatches
                .filter(d => d.dispatch_status === 'Executed' && d.actual_dispatch_date)
                .map(d => d.actual_dispatch_date);
            
            const maxDispatchDate = actualDispatchDates.length > 0 
                ? actualDispatchDates.reduce((max, cur) => cur > max ? cur : max, actualDispatchDates[0]) 
                : null;

            let newStatus = po.commitment_status || 'Pending';

            if (isFullyDispatched) {
                if (maxDispatchDate) {
                    if (maxDispatchDate <= po.committed_dispatch_date) {
                        newStatus = 'Honored';
                    } else {
                        newStatus = 'Missed';
                    }
                } else {
                    // Fully dispatched without an execution date (fallback to system date)
                    newStatus = systemDate <= po.committed_dispatch_date ? 'Honored' : 'Missed';
                }
            } else {
                if (systemDate > po.committed_dispatch_date) {
                    newStatus = 'Missed';
                } else if (po.commitment_status !== 'Renegotiated') {
                    newStatus = 'Pending';
                }
            }

            if (newStatus !== po.commitment_status) {
                await queryRun(
                    "UPDATE purchase_orders SET commitment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    [newStatus, po.id]
                );

                // Insert into history
                const countRow = await queryGet(
                    "SELECT COUNT(*) as count FROM po_commitment_history WHERE po_id = ? AND status = ?",
                    [po.id, newStatus]
                );
                if (!countRow || countRow.count === 0) {
                    await queryRun(
                        `INSERT INTO po_commitment_history (po_id, committed_date, status, reason)
                         VALUES (?, ?, ?, ?)`,
                        [
                            po.id, 
                            po.committed_dispatch_date, 
                            newStatus, 
                            newStatus === 'Missed' ? 'System auto-detected missed commitment date' : 'System auto-detected order fulfilled'
                        ]
                    );
                }
            }
        }

        // Update company commitment health scores
        const companies = await queryAll("SELECT id FROM companies");
        for (const company of companies) {
            const commitments = await queryAll(
                `SELECT id, commitment_status 
                 FROM purchase_orders 
                 WHERE company_id = ? AND committed_dispatch_date IS NOT NULL`,
                [company.id]
            );

            const resolvedCommitments = commitments.filter(c => c.commitment_status === 'Honored' || c.commitment_status === 'Missed');
            if (resolvedCommitments.length > 0) {
                const total = resolvedCommitments.length;
                const honored = commitments.filter(c => c.commitment_status === 'Honored').length;
                const score = (honored / total) * 100;
                const riskFlag = score < 60 ? 1 : 0;

                await queryRun(
                    `UPDATE companies 
                     SET commitment_health_score = ?, relationship_risk_flag = ?, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [score, riskFlag, company.id]
                );
            } else {
                await queryRun(
                    `UPDATE companies 
                     SET commitment_health_score = NULL, relationship_risk_flag = 0, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [company.id]
                );
            }
        }
    } catch (e) {
        console.error("Error in syncPOCommitmentStatuses:", e);
    }
}

// Helper: Get configurable thresholds
async function getInventoryThresholds() {
    const rows = await queryAll("SELECT key, value FROM system_settings WHERE key LIKE 'min_threshold_%'");
    const thresholds = {};
    rows.forEach(r => {
        const prod = r.key.replace('min_threshold_', '');
        thresholds[prod] = parseFloat(r.value);
    });
    return thresholds;
}

// Helper: Check for unconfirmed snapshots
async function getUnconfirmedSnapshotsCount(systemDate) {
    const row = await queryGet("SELECT COUNT(*) as count FROM inventory_snapshots WHERE date <= ? AND confirmed = 0", [systemDate]);
    return row ? parseInt(row.count) : 0;
}

// Helper: Calculate 90-day average for a company's order of a product type
async function getCompany90DayAverage(companyId, productType, systemDate) {
    const dateLimit = new Date(systemDate);
    dateLimit.setDate(dateLimit.getDate() - 90);
    const dateLimitStr = dateLimit.toISOString().split('T')[0];

    const row = await queryGet(
        `SELECT AVG(li.quantity) as avg_qty 
         FROM po_line_items li
         JOIN purchase_orders po ON li.po_id = po.id
         WHERE po.company_id = ? AND li.product_type = ? AND po.status = 'Closed' AND po.date_received >= ?`,
        [companyId, productType, dateLimitStr]
    );
    return row && row.avg_qty ? parseFloat(row.avg_qty) : null;
}

// Helper: Calculate actual vs planned production variance ratio
async function getProductionPerformanceRatio(productType, systemDate) {
    const rows = await queryAll(
        `SELECT planned_quantity, actual_quantity 
         FROM production_plans 
         WHERE product_type = ? AND week_start_date < ? 
         ORDER BY week_start_date DESC LIMIT 2`,
        [productType, systemDate]
    );
    
    if (!rows || rows.length === 0) return 1.0;
    
    let totalPlanned = 0;
    let totalActual = 0;
    rows.forEach(r => {
        totalPlanned += r.planned_quantity;
        totalActual += r.actual_quantity;
    });
    
    if (totalPlanned === 0) return 1.0;
    return totalActual / totalPlanned;
}

// ==========================================
// 1. Settings Endpoints
// ==========================================
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await queryAll("SELECT * FROM system_settings");
        
        const settingsMap = {};
        settings.forEach(s => {
            settingsMap[s.key] = s.value;
        });
        res.json(settingsMap);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const body = req.body;
        
        // Use a transaction to update settings
        await runInTransaction(async (tx) => {
            for (const [key, val] of Object.entries(body)) {
                // SQLite ON CONFLICT works in PostgreSQL too!
                await tx.run(
                    "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
                    [key, String(val)]
                );
            }
        });
        
        res.json({ success: true, message: 'Settings updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. Company Endpoints
// ==========================================
app.get('/api/companies', async (req, res) => {
    try {
        const rows = await queryAll("SELECT * FROM companies ORDER BY name ASC");
        res.json(rows.map(r => ({
            ...r,
            primary_products: typeof r.primary_products === 'string' ? JSON.parse(r.primary_products) : r.primary_products
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/companies', async (req, res) => {
    try {
        const { id, name, tier, primary_products, contact_person, contact_phone, credit_status, created_by } = req.body;
        
        if (!id || !name || !tier || !primary_products || primary_products.length === 0) {
            return res.status(400).json({ error: 'Company ID, Name, Tier, and Primary Products are required.' });
        }
        
        await queryRun(
            `INSERT INTO companies (id, name, tier, primary_products, contact_person, contact_phone, credit_status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, name, tier, JSON.stringify(primary_products), contact_person || '', contact_phone || '', credit_status || 'Active', created_by || 'System']
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/companies/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, tier, primary_products, contact_person, contact_phone, credit_status } = req.body;
        await queryRun(
            `UPDATE companies 
             SET name = ?, tier = ?, primary_products = ?, contact_person = ?, contact_phone = ?, credit_status = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [name, tier, JSON.stringify(primary_products), contact_person, contact_phone, credit_status, id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. PO Management Endpoints
// ==========================================
app.get('/api/pos', async (req, res) => {
    try {
        const systemDate = await getSystemDate();
        await syncPOCommitmentStatuses(systemDate);
        
        const pos = await queryAll(
            `SELECT po.*, c.name as company_name, c.tier as company_tier, c.credit_status as company_credit_status, c.relationship_risk_flag
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             ORDER BY po.date_received DESC`
        );

        const result = [];
        for (const po of pos) {
            const items = await queryAll("SELECT * FROM po_line_items WHERE po_id = ?", [po.id]);
            
            // Calculate Order Age in days
            const recDate = new Date(po.date_received);
            const sysDateObj = new Date(systemDate);
            const ageDays = Math.max(0, Math.floor((sysDateObj - recDate) / (1000 * 60 * 60 * 24)));
            
            // Anomaly Detection: check if quantity > 2x 90-day average
            let isAnomalous = false;
            const itemSummaries = [];
            for (const item of items) {
                const avg90 = await getCompany90DayAverage(po.company_id, item.product_type, systemDate);
                let itemAnomalous = false;
                if (avg90 !== null && item.quantity > 2 * avg90) {
                    itemAnomalous = true;
                    isAnomalous = true;
                }
                itemSummaries.push({
                    ...item,
                    avg_90day: avg90,
                    is_anomalous: itemAnomalous
                });
            }

            result.push({
                ...po,
                order_age: ageDays,
                anomaly_flag: isAnomalous ? 1 : 0,
                items: itemSummaries,
                total_qty: items.reduce((acc, curr) => acc + curr.quantity, 0),
                allocated_qty: items.reduce((acc, curr) => acc + curr.allocated_quantity, 0)
            });
        }
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const systemDate = await getSystemDate();
        await syncPOCommitmentStatuses(systemDate);

        const po = await queryGet(
            `SELECT po.*, c.name as company_name, c.tier as company_tier, c.credit_status as company_credit_status, c.commitment_health_score
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             WHERE po.id = ?`,
            [id]
        );

        if (!po) {
            return res.status(404).json({ error: 'Purchase Order not found.' });
        }

        const items = await queryAll("SELECT * FROM po_line_items WHERE po_id = ?", [id]);
        const itemDetails = [];
        for (const item of items) {
            const avg90 = await getCompany90DayAverage(po.company_id, item.product_type, systemDate);
            itemDetails.push({
                ...item,
                avg_90day: avg90,
                is_anomalous: avg90 !== null && item.quantity > 2 * avg90
            });
        }

        // Get allocations linked to this PO
        const allocations = await queryAll(
            `SELECT da.*, dl.vehicle_id, dl.planned_dispatch_date, dl.actual_dispatch_date, dl.status as dispatch_status
             FROM dispatch_allocations da
             JOIN dispatch_log dl ON da.dispatch_id = dl.id
             WHERE da.po_id = ?`,
            [id]
        );

        // Get commitment history
        const commitmentHistory = await queryAll(
            "SELECT * FROM po_commitment_history WHERE po_id = ? ORDER BY timestamp ASC",
            [id]
        );

        res.json({
            ...po,
            items: itemDetails,
            allocations,
            commitment_history: commitmentHistory
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pos', async (req, res) => {
    try {
        const { id, company_id, date_received, committed_dispatch_date, notes, items, created_by } = req.body;

        if (!id || !company_id || !date_received || !items || items.length === 0) {
            return res.status(400).json({ error: 'PO ID, Company, Date Received, and Line Items are required.' });
        }

        // Validate company exists and has a tier
        const company = await queryGet("SELECT tier FROM companies WHERE id = ?", [company_id]);
        if (!company) {
            return res.status(400).json({ error: 'Company does not exist in master.' });
        }
        if (!company.tier) {
            return res.status(400).json({ error: 'Company must have a tier assigned before creating purchase orders.' });
        }

        const systemDate = await getSystemDate();

        await runInTransaction(async (tx) => {
            const defaultStatus = committed_dispatch_date ? 'Pending' : null;
            await tx.run(
                `INSERT INTO purchase_orders (id, company_id, date_received, committed_dispatch_date, commitment_status, status, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, 'Received', ?, ?)`,
                [id, company_id, date_received, committed_dispatch_date || null, defaultStatus, notes || '', created_by || 'System']
            );

            if (committed_dispatch_date) {
                await tx.run(
                    `INSERT INTO po_commitment_history (po_id, committed_date, status, reason)
                     VALUES (?, ?, 'Pending', 'Initial commitment set on order creation')`,
                    [id, committed_dispatch_date]
                );
            }

            for (const item of items) {
                if (isNaN(item.quantity) || parseFloat(item.quantity) <= 0) {
                    throw new Error('Quantity must be a positive number.');
                }
                await tx.run(
                    `INSERT INTO po_line_items (po_id, product_type, quantity, allocated_quantity)
                     VALUES (?, ?, ?, 0)`,
                    [id, item.product_type, parseFloat(item.quantity)]
                );
            }
        });

        await syncPOCommitmentStatuses(systemDate);

        res.json({ success: true, message: 'Purchase Order created successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pos/:id/renegotiate', async (req, res) => {
    try {
        const { id } = req.params;
        const { new_committed_date, reason } = req.body;
        
        if (!new_committed_date) {
            return res.status(400).json({ error: 'New committed date is required.' });
        }

        const po = await queryGet("SELECT * FROM purchase_orders WHERE id = ?", [id]);
        if (!po) {
            return res.status(404).json({ error: 'Purchase Order not found.' });
        }

        const systemDate = await getSystemDate();

        await runInTransaction(async (tx) => {
            // Update PO
            await tx.run(
                `UPDATE purchase_orders 
                 SET committed_dispatch_date = ?, commitment_status = 'Renegotiated', updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [new_committed_date, id]
            );

            // Log to commitment history
            await tx.run(
                `INSERT INTO po_commitment_history (po_id, committed_date, status, reason)
                 VALUES (?, ?, 'Renegotiated', ?)`,
                [id, new_committed_date, reason || 'Renegotiated by planner']
            );
        });

        // Trigger sync to update company scores
        await syncPOCommitmentStatuses(systemDate);

        res.json({ success: true, message: 'PO commitment date renegotiated successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. Dispatch Planning & AI Optimizer Endpoints
// ==========================================
app.get('/api/optimizer', async (req, res) => {
    try {
        const systemDate = await getSystemDate();
        
        // 1. Get stock levels as of today
        const stockRows = await queryAll("SELECT product_type, closing_stock FROM inventory_snapshots WHERE date = ?", [systemDate]);
        const currentStocks = {};
        // Default to 0 for products with missing snapshots
        ['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene'].forEach(p => {
            currentStocks[p] = 0.0;
        });
        stockRows.forEach(r => {
            currentStocks[r.product_type] = r.closing_stock;
        });

        // 2. Fetch all PO line items in Received or Partially Allocated status
        const pendingItems = await queryAll(
            `SELECT li.*, po.date_received, po.committed_dispatch_date, po.commitment_status, c.id as company_id, c.name as company_name, c.tier as company_tier, c.credit_status
             FROM po_line_items li
             JOIN purchase_orders po ON li.po_id = po.id
             JOIN companies c ON po.company_id = c.id
             WHERE po.status IN ('Received', 'Partially Allocated') AND (li.quantity - li.allocated_quantity) > 0`
        );

        // 3. Run scoring algorithm
        const scoredItems = [];
        
        for (const item of pendingItems) {
            const pendingQty = item.quantity - item.allocated_quantity;
            const recDate = new Date(item.date_received);
            const sysDateObj = new Date(systemDate);
            const ageDays = Math.max(0, Math.floor((sysDateObj - recDate) / (1000 * 60 * 60 * 24)));
            
            // Base points
            let basePoints = 20;
            if (item.company_tier === 'A') basePoints = 100;
            else if (item.company_tier === 'B') basePoints = 60;
            
            // Age points
            const agePoints = Math.min(40, ageDays * 2);
            
            // Stock penalty
            const availableStock = currentStocks[item.product_type] || 0.0;
            const hasStockPenalty = availableStock < pendingQty;
            const stockPenalty = hasStockPenalty ? -30 : 0;
            
            // Commitment urgency points
            let commitmentPoints = 0;
            if (item.committed_dispatch_date) {
                if (item.commitment_status === 'Missed' || systemDate > item.committed_dispatch_date) {
                    commitmentPoints = 35;
                } else if (systemDate === item.committed_dispatch_date) {
                    commitmentPoints = 25;
                }
            }
            
            const score = basePoints + agePoints + stockPenalty + commitmentPoints;
            
            scoredItems.push({
                ...item,
                pending_quantity: pendingQty,
                order_age_days: ageDays,
                base_points: basePoints,
                age_points: agePoints,
                stock_penalty: stockPenalty,
                commitment_points: commitmentPoints,
                score: score,
                available_stock: availableStock
            });
        }

        // Sort items by final score DESC
        scoredItems.sort((a, b) => b.score - a.score);

        // 4. Generate Recommendations (Vehicle Consolidation)
        const capRow = await queryGet("SELECT value FROM system_settings WHERE key = 'vehicle_capacity_mt'");
        const maxCapacity = capRow ? parseFloat(capRow.value) : 32.0;

        // Group by product
        const recommendedRuns = [];
        const remainingStocks = { ...currentStocks };
        const itemsByProduct = {};

        scoredItems.forEach(item => {
            if (!itemsByProduct[item.product_type]) {
                itemsByProduct[item.product_type] = [];
            }
            itemsByProduct[item.product_type].push(item);
        });

        let runCounter = 1;
        for (const [prod, items] of Object.entries(itemsByProduct)) {
            let currentRunItems = [];
            let currentRunQty = 0;

            for (const item of items) {
                if (item.credit_status === 'On Hold') {
                    continue;
                }

                let qtyToAllocate = Math.min(item.pending_quantity, remainingStocks[prod]);
                if (qtyToAllocate <= 0) continue;

                while (qtyToAllocate > 0) {
                    const capacityLeft = maxCapacity - currentRunQty;
                    const allocation = Math.min(qtyToAllocate, capacityLeft);

                    if (allocation <= 0) break;

                    currentRunItems.push({
                        po_id: item.po_id,
                        po_line_item_id: item.id,
                        company_id: item.company_id,
                        company_name: item.company_name,
                        company_tier: item.company_tier,
                        quantity: allocation,
                        score: item.score
                    });

                    currentRunQty += allocation;
                    qtyToAllocate -= allocation;
                    remainingStocks[prod] -= allocation;

                    if (currentRunQty >= maxCapacity) {
                        recommendedRuns.push({
                            run_id: `RUN-${prod.substring(0, 3).toUpperCase()}-${String(runCounter).padStart(3, '0')}`,
                            product_type: prod,
                            total_quantity: currentRunQty,
                            allocations: currentRunItems
                        });
                        runCounter++;
                        currentRunItems = [];
                        currentRunQty = 0;
                    }
                }
            }

            if (currentRunItems.length > 0) {
                recommendedRuns.push({
                    run_id: `RUN-${prod.substring(0, 3).toUpperCase()}-${String(runCounter).padStart(3, '0')}`,
                    product_type: prod,
                    total_quantity: currentRunQty,
                    allocations: currentRunItems
                });
                runCounter++;
            }
        }

        res.json({
            system_date: systemDate,
            inventory_stocks: currentStocks,
            remaining_stocks: remainingStocks,
            actionable_po_pool: scoredItems,
            recommended_runs: recommendedRuns
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bulk approve / accept AI plan
app.post('/api/optimizer/accept', async (req, res) => {
    try {
        const { runs, created_by, override_logs } = req.body;
        
        if (!runs || runs.length === 0) {
            return res.status(400).json({ error: 'No vehicle runs supplied.' });
        }

        const systemDate = await getSystemDate();

        await runInTransaction(async (tx) => {
            for (const run of runs) {
                const dispatchId = `DSP-${run.run_id}-${Date.now().toString().slice(-4)}`;
                
                await tx.run(
                    `INSERT INTO dispatch_log (id, product_type, quantity, vehicle_id, planned_dispatch_date, status, created_by)
                     VALUES (?, ?, ?, ?, ?, 'Planned', ?)`,
                    [dispatchId, run.product_type, run.total_quantity, run.run_id, systemDate, created_by || 'System']
                );

                for (const alloc of run.allocations) {
                    const comp = await tx.get("SELECT credit_status FROM companies WHERE id = ?", [alloc.company_id]);
                    if (comp && comp.credit_status === 'On Hold') {
                        const override = override_logs?.find(o => o.po_id === alloc.po_id);
                        if (!override) {
                            throw new Error(`Credit hold override reason required for company: ${alloc.company_name} (PO: ${alloc.po_id})`);
                        }
                        console.log(`Credit Hold Override Logged: PO ${alloc.po_id} - Reason: ${override.reason}`);
                    }

                    await tx.run(
                        `INSERT INTO dispatch_allocations (dispatch_id, po_id, po_line_item_id, quantity)
                         VALUES (?, ?, ?, ?)`,
                        [dispatchId, alloc.po_id, alloc.po_line_item_id, alloc.quantity]
                    );

                    await tx.run(
                        `UPDATE po_line_items 
                         SET allocated_quantity = allocated_quantity + ?, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = ?`,
                        [alloc.quantity, alloc.po_line_item_id]
                    );

                    const poItems = await tx.all("SELECT quantity, allocated_quantity FROM po_line_items WHERE po_id = ?", [alloc.po_id]);
                    const totalOrdered = poItems.reduce((s, c) => s + c.quantity, 0);
                    const totalAllocated = poItems.reduce((s, c) => s + c.allocated_quantity, 0);

                    let newStatus = 'Received';
                    if (totalAllocated >= totalOrdered) {
                        newStatus = 'Fully Allocated';
                    } else if (totalAllocated > 0) {
                        newStatus = 'Partially Allocated';
                    }

                    await tx.run(
                        `UPDATE purchase_orders 
                         SET status = ?, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = ?`,
                        [newStatus, alloc.po_id]
                    );
                }
            }
        });

        res.json({ success: true, message: 'Dispatch plan approved and saved.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update single dispatch record (Execute, Cancel)
app.put('/api/dispatch/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, cancellation_reason, actual_dispatch_date } = req.body;
        
        const dispatch = await queryGet("SELECT * FROM dispatch_log WHERE id = ?", [id]);
        if (!dispatch) {
            return res.status(404).json({ error: 'Dispatch record not found.' });
        }

        if (dispatch.status === 'Executed') {
            if (status !== 'Cancelled') {
                return res.status(400).json({ error: 'Executed dispatches are immutable and can only be Cancelled.' });
            }
            if (!cancellation_reason) {
                return res.status(400).json({ error: 'Cancellation reason is required to cancel an executed dispatch.' });
            }
        }

        await runInTransaction(async (tx) => {
            const finalStatus = status;
            const actualDate = status === 'Executed' ? (actual_dispatch_date || dispatch.planned_dispatch_date) : null;

            await tx.run(
                `UPDATE dispatch_log 
                 SET status = ?, cancellation_reason = ?, actual_dispatch_date = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [finalStatus, cancellation_reason || null, actualDate, id]
            );

            if (finalStatus === 'Executed' && dispatch.status !== 'Executed') {
                const systemDate = actualDate;
                const snapshotId = `${dispatch.product_type}_${systemDate}`;

                const snapshot = await tx.get("SELECT * FROM inventory_snapshots WHERE id = ?", [snapshotId]);
                if (snapshot) {
                    const newDispatched = snapshot.dispatched_out + dispatch.quantity;
                    const newClosing = Math.max(0, snapshot.opening_stock + snapshot.production_added + snapshot.purchased_material_received - newDispatched);
                    await tx.run(
                        `UPDATE inventory_snapshots 
                         SET dispatched_out = ?, closing_stock = ?, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = ?`,
                        [newDispatched, newClosing, snapshotId]
                    );
                } else {
                    const yesterday = new Date(systemDate);
                    yesterday.setDate(yesterday.getDate() - 1);
                    const yestStr = yesterday.toISOString().split('T')[0];
                    const yestSnap = await tx.get("SELECT closing_stock FROM inventory_snapshots WHERE product_type = ? AND date = ?", [dispatch.product_type, yestStr]);
                    const openStock = yestSnap ? yestSnap.closing_stock : 0.0;
                    const closeStock = Math.max(0, openStock - dispatch.quantity);

                    await tx.run(
                        `INSERT INTO inventory_snapshots (id, product_type, date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed)
                         VALUES (?, ?, ?, ?, 0, 0, ?, ?, 0)`,
                        [snapshotId, dispatch.product_type, systemDate, openStock, dispatch.quantity, closeStock]
                    );
                }

                const allocations = await tx.all("SELECT * FROM dispatch_allocations WHERE dispatch_id = ?", [id]);
                for (const alloc of allocations) {
                    const poItems = await tx.all("SELECT SUM(quantity) as tot_qty, SUM(allocated_quantity) as tot_alloc FROM po_line_items WHERE po_id = ?", [alloc.po_id]);
                    const totalQty = poItems[0].tot_qty;
                    const totalAlloc = poItems[0].tot_alloc;

                    if (totalAlloc >= totalQty) {
                        await tx.run("UPDATE purchase_orders SET status = 'Dispatched', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [alloc.po_id]);
                    }
                }
            }

            if (finalStatus === 'Cancelled') {
                const allocations = await tx.all("SELECT * FROM dispatch_allocations WHERE dispatch_id = ?", [id]);
                for (const alloc of allocations) {
                    await tx.run(
                        `UPDATE po_line_items 
                         SET allocated_quantity = MAX(0, allocated_quantity - ?), updated_at = CURRENT_TIMESTAMP 
                         WHERE id = ?`,
                        [alloc.quantity, alloc.po_line_item_id]
                    );

                    const poItems = await tx.all("SELECT quantity, allocated_quantity FROM po_line_items WHERE po_id = ?", [alloc.po_id]);
                    const totalOrdered = poItems.reduce((s, c) => s + c.quantity, 0);
                    const totalAllocated = poItems.reduce((s, c) => s + c.allocated_quantity, 0);

                    let newStatus = 'Received';
                    if (totalAllocated >= totalOrdered && totalOrdered > 0) {
                        newStatus = 'Fully Allocated';
                    } else if (totalAllocated > 0) {
                        newStatus = 'Partially Allocated';
                    }

                    await tx.run(
                        `UPDATE purchase_orders 
                         SET status = ?, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = ?`,
                        [newStatus, alloc.po_id]
                    );
                }

                if (dispatch.status === 'Executed') {
                    const systemDate = dispatch.actual_dispatch_date || dispatch.planned_dispatch_date;
                    const snapshotId = `${dispatch.product_type}_${systemDate}`;
                    const snapshot = await tx.get("SELECT * FROM inventory_snapshots WHERE id = ?", [snapshotId]);
                    if (snapshot) {
                        const newDispatched = Math.max(0, snapshot.dispatched_out - dispatch.quantity);
                        const newClosing = Math.max(0, snapshot.opening_stock + snapshot.production_added + snapshot.purchased_material_received - newDispatched);
                        await tx.run(
                            `UPDATE inventory_snapshots 
                             SET dispatched_out = ?, closing_stock = ?, updated_at = CURRENT_TIMESTAMP 
                             WHERE id = ?`,
                            [newDispatched, newClosing, snapshotId]
                        );
                    }
                }
            }
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dispatch', async (req, res) => {
    try {
        const rows = await queryAll("SELECT * FROM dispatch_log ORDER BY planned_dispatch_date DESC, id DESC");
        
        for (const row of rows) {
            const allocs = await queryAll(
                `SELECT da.*, po.company_id, c.name as company_name 
                 FROM dispatch_allocations da
                 JOIN purchase_orders po ON da.po_id = po.id
                 JOIN companies c ON po.company_id = c.id
                 WHERE da.dispatch_id = ?`,
                [row.id]
            );
            row.allocations = allocs;
        }

        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 5. Inventory Snapshot Endpoints
// ==========================================
app.get('/api/inventory', async (req, res) => {
    try {
        const systemDate = await getSystemDate();
        const thresholds = await getInventoryThresholds();

        const snapshots = await queryAll(
            `SELECT * FROM inventory_snapshots 
             WHERE date <= ? 
             ORDER BY date DESC, product_type ASC 
             LIMIT 270`,
            [systemDate]
        );

        const result = [];
        for (const snap of snapshots) {
            const sumRow = await queryGet(
                `SELECT SUM(quantity) as total_qty 
                 FROM dispatch_log 
                 WHERE product_type = ? AND status = 'Executed' AND actual_dispatch_date = ?`,
                [snap.product_type, snap.date]
            );
            const actualDispatched = sumRow && sumRow.total_qty ? parseFloat(sumRow.total_qty) : 0.0;
            
            const delta = Math.abs(snap.dispatched_out - actualDispatched);
            const hasMismatch = delta > 0.01;

            const minT = thresholds[snap.product_type] || 0.0;
            let health = 'green';
            if (snap.closing_stock <= 0) {
                health = 'red';
            } else if (snap.closing_stock < minT) {
                health = 'red';
            } else if (snap.closing_stock < minT * 1.5) {
                health = 'amber';
            }

            result.push({
                ...snap,
                actual_dispatched_records_sum: actualDispatched,
                reconciliation_mismatch: hasMismatch,
                reconciliation_delta: delta,
                health: health,
                min_threshold: minT
            });
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/inventory/confirm', async (req, res) => {
    try {
        const { date, product_types, created_by } = req.body;
        
        if (!date || !product_types || product_types.length === 0) {
            return res.status(400).json({ error: 'Date and product types are required.' });
        }

        await runInTransaction(async (tx) => {
            for (const prod of product_types) {
                const snapshotId = `${prod}_${date}`;
                
                const snap = await tx.get("SELECT * FROM inventory_snapshots WHERE id = ?", [snapshotId]);
                if (!snap) {
                    throw new Error(`Inventory snapshot for ${prod} on date ${date} does not exist. Create it first.`);
                }

                const calculatedClosing = Math.max(0, snap.opening_stock + snap.production_added + snap.purchased_material_received - snap.dispatched_out);
                
                await tx.run(
                    `UPDATE inventory_snapshots 
                     SET confirmed = 1, closing_stock = ?, updated_at = CURRENT_TIMESTAMP, created_by = ? 
                     WHERE id = ?`,
                    [calculatedClosing, created_by || 'System', snapshotId]
                );

                const nextDay = new Date(date);
                nextDay.setDate(nextDay.getDate() + 1);
                const nextDayStr = nextDay.toISOString().split('T')[0];
                const nextDaySnapId = `${prod}_${nextDayStr}`;

                const nextSnap = await tx.get("SELECT * FROM inventory_snapshots WHERE id = ?", [nextDaySnapId]);
                if (nextSnap) {
                    const nextClosing = Math.max(0, calculatedClosing + nextSnap.production_added + nextSnap.purchased_material_received - nextSnap.dispatched_out);
                    await tx.run(
                        `UPDATE inventory_snapshots 
                         SET opening_stock = ?, closing_stock = ? 
                         WHERE id = ?`,
                        [calculatedClosing, nextClosing, nextDaySnapId]
                    );
                }
            }
        });

        res.json({ success: true, message: `Day ${date} inventory snapshots locked successfully.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/inventory/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { opening_stock, production_added, purchased_material_received, dispatched_out, confirmed } = req.body;
        
        const [prod, date] = id.split('_');
        
        const existing = await queryGet("SELECT * FROM inventory_snapshots WHERE id = ?", [id]);
        
        const opStock = parseFloat(opening_stock);
        const prodAdd = parseFloat(production_added || 0);
        const purRec = parseFloat(purchased_material_received || 0);
        const dispOut = parseFloat(dispatched_out || 0);
        const clStock = Math.max(0, opStock + prodAdd + purRec - dispOut);

        if (existing && existing.confirmed === 1) {
            return res.status(400).json({ error: 'Confirmed snapshots are locked and cannot be edited.' });
        }

        await runInTransaction(async (tx) => {
            await tx.run(
                `INSERT INTO inventory_snapshots (id, product_type, date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(id) DO UPDATE SET 
                    opening_stock = excluded.opening_stock,
                    production_added = excluded.production_added,
                    purchased_material_received = excluded.purchased_material_received,
                    dispatched_out = excluded.dispatched_out,
                    closing_stock = excluded.closing_stock,
                    confirmed = excluded.confirmed,
                    updated_at = CURRENT_TIMESTAMP`,
                [id, prod, date, opStock, prodAdd, purRec, dispOut, clStock, confirmed ? 1 : 0]
            );

            const nextDay = new Date(date);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayStr = nextDay.toISOString().split('T')[0];
            const nextDaySnapId = `${prod}_${nextDayStr}`;
            const nextSnap = await tx.get("SELECT * FROM inventory_snapshots WHERE id = ?", [nextDaySnapId]);
            if (nextSnap) {
                const nextClosing = Math.max(0, clStock + nextSnap.production_added + nextSnap.purchased_material_received - nextSnap.dispatched_out);
                await tx.run(
                    `UPDATE inventory_snapshots SET opening_stock = ?, closing_stock = ? WHERE id = ?`,
                    [clStock, nextClosing, nextDaySnapId]
                );
            }
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 6. Production Plan Endpoints
// ==========================================
app.get('/api/production', async (req, res) => {
    try {
        const rows = await queryAll("SELECT * FROM production_plans ORDER BY week_start_date DESC, product_type ASC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/production', async (req, res) => {
    try {
        const { product_type, week_start_date, planned_quantity, actual_quantity } = req.body;
        
        if (!product_type || !week_start_date) {
            return res.status(400).json({ error: 'Product type and Week start date are required.' });
        }

        await queryRun(
            `INSERT INTO production_plans (product_type, week_start_date, planned_quantity, actual_quantity, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(product_type, week_start_date) DO UPDATE SET
                planned_quantity = excluded.planned_quantity,
                actual_quantity = excluded.actual_quantity,
                updated_at = CURRENT_TIMESTAMP`,
            [product_type, week_start_date, parseFloat(planned_quantity || 0), parseFloat(actual_quantity || 0)]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 7. Dashboard Endpoint (Aggregations)
// ==========================================
app.get('/api/dashboard', async (req, res) => {
    try {
        const systemDate = await getSystemDate();
        await syncPOCommitmentStatuses(systemDate);
        const thresholds = await getInventoryThresholds();

        // 1. Unconfirmed snapshots banner flag
        const unconfirmedCount = await getUnconfirmedSnapshotsCount(systemDate);

        // 2. POs count by tier
        const poTiers = await queryAll(
            `SELECT c.tier, COUNT(po.id) as count 
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             WHERE po.status IN ('Received', 'Partially Allocated')
             GROUP BY c.tier`
        );
        const tierCounts = { A: 0, B: 0, C: 0 };
        poTiers.forEach(pt => {
            tierCounts[pt.tier] = parseInt(pt.count);
        });

        // 3. Current stock levels
        const stockRows = await queryAll("SELECT product_type, closing_stock FROM inventory_snapshots WHERE date = ?", [systemDate]);
        const currentStocks = {};
        stockRows.forEach(r => {
            currentStocks[r.product_type] = r.closing_stock;
        });
        
        const products = ['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene'];
        const stockStatuses = products.map(prod => {
            const stock = currentStocks[prod] !== undefined ? currentStocks[prod] : 0.0;
            const minT = thresholds[prod] || 0.0;
            let status = 'green';
            if (stock <= 0) {
                status = 'red';
            } else if (stock < minT) {
                status = 'red';
            } else if (stock < minT * 1.5) {
                status = 'amber';
            }
            return {
                product_type: prod,
                stock: stock,
                threshold: minT,
                status: status
            };
        });

        // 4. Anomalous POs warning list
        const pos = await queryAll(
            `SELECT po.*, c.name as company_name 
             FROM purchase_orders po 
             JOIN companies c ON po.company_id = c.id
             WHERE po.status IN ('Received', 'Partially Allocated')`
        );
        const anomalousPOs = [];
        for (const po of pos) {
            const items = await queryAll("SELECT * FROM po_line_items WHERE po_id = ?", [po.id]);
            let isPoAnomalous = false;
            for (const item of items) {
                const avg90 = await getCompany90DayAverage(po.company_id, item.product_type, systemDate);
                if (avg90 !== null && item.quantity > 2 * avg90) {
                    isPoAnomalous = true;
                    anomalousPOs.push({
                        po_id: po.id,
                        company_name: po.company_name,
                        product_type: item.product_type,
                        qty: item.quantity,
                        avg_90day: avg90
                    });
                }
            }
        }

        // 5. Shortage Alert Trigger & 7-Day Forward Projections
        const shortageAlerts = [];
        const forwardProjections = {};

        for (const prod of products) {
            const minT = thresholds[prod] || 0.0;
            const startStock = currentStocks[prod] !== undefined ? currentStocks[prod] : 100.0;
            const projList = [{ day: 0, date: systemDate, stock: startStock }];

            const prodRatio = await getProductionPerformanceRatio(prod, systemDate);

            const planRow = await queryGet(
                `SELECT planned_quantity FROM production_plans 
                 WHERE product_type = ? AND week_start_date <= ? 
                 ORDER BY week_start_date DESC LIMIT 1`,
                [prod, systemDate]
            );
            const weeklyPlanned = planRow ? planRow.planned_quantity : 50.0;
            const dailyProduction = (weeklyPlanned / 7.0) * (prodRatio < 1.0 ? prodRatio : 1.0);

            const plannedDispatches = await queryAll(
                `SELECT planned_dispatch_date, SUM(quantity) as total_qty 
                 FROM dispatch_log 
                 WHERE product_type = ? AND status = 'Planned' AND planned_dispatch_date >= ?
                 GROUP BY planned_dispatch_date`,
                [prod, systemDate]
            );
            const plannedDispMap = {};
            plannedDispatches.forEach(d => {
                plannedDispMap[d.planned_dispatch_date] = d.total_qty;
            });

            const unscheduledRow = await queryGet(
                `SELECT SUM(li.quantity - li.allocated_quantity) as unscheduled_qty
                 FROM po_line_items li
                 JOIN purchase_orders po ON li.po_id = po.id
                 WHERE li.product_type = ? AND po.status IN ('Received', 'Partially Allocated')`,
                [prod]
            );
            const unscheduledQty = unscheduledRow && unscheduledRow.unscheduled_qty ? parseFloat(unscheduledRow.unscheduled_qty) : 0;

            let prevStock = startStock;
            let flaggedShortage = false;

            for (let t = 1; t <= 7; t++) {
                const pDate = new Date(systemDate);
                pDate.setDate(pDate.getDate() + t);
                const pDateStr = pDate.toISOString().split('T')[0];

                const dispatchQty = parseFloat(plannedDispMap[pDateStr] || 0.0);
                
                let expectedDemand = dispatchQty;
                if (t >= 1 && t <= 3) {
                    expectedDemand += (unscheduledQty / 3.0);
                }

                const nextStock = Math.max(0, prevStock + dailyProduction - expectedDemand);
                projList.push({ day: t, date: pDateStr, stock: parseFloat(nextStock.toFixed(2)) });

                if (nextStock < minT && !flaggedShortage) {
                    shortageAlerts.push({
                        product_type: prod,
                        projected_date: pDateStr,
                        days_out: t,
                        projected_stock: parseFloat(nextStock.toFixed(2)),
                        min_threshold: minT,
                        production_ratio_alert: prodRatio < 0.9 ? prodRatio : null
                    });
                    flaggedShortage = true;
                }
                prevStock = nextStock;
            }
            forwardProjections[prod] = projList;
        }

        // Get AI recommendation list (with commitment urgency scoring)
        const pendingItems = await queryAll(
            `SELECT li.*, po.date_received, po.committed_dispatch_date, po.commitment_status, c.name as company_name, c.tier as company_tier
             FROM po_line_items li
             JOIN purchase_orders po ON li.po_id = po.id
             JOIN companies c ON po.company_id = c.id
             WHERE po.status IN ('Received', 'Partially Allocated') AND (li.quantity - li.allocated_quantity) > 0`
        );
        const recommPool = [];
        for (const item of pendingItems) {
            const pendingQty = item.quantity - item.allocated_quantity;
            const recDate = new Date(item.date_received);
            const sysDateObj = new Date(systemDate);
            const ageDays = Math.max(0, Math.floor((sysDateObj - recDate) / (1000 * 60 * 60 * 24)));
            
            let basePoints = item.company_tier === 'A' ? 100 : item.company_tier === 'B' ? 60 : 20;
            let agePoints = Math.min(40, ageDays * 2);
            let availableStock = currentStocks[item.product_type] || 0.0;
            let stockPenalty = availableStock < pendingQty ? -30 : 0;

            let commitmentPoints = 0;
            if (item.committed_dispatch_date) {
                if (item.commitment_status === 'Missed' || systemDate > item.committed_dispatch_date) {
                    commitmentPoints = 35;
                } else if (systemDate === item.committed_dispatch_date) {
                    commitmentPoints = 25;
                }
            }
            
            recommPool.push({
                po_id: item.po_id,
                company_name: item.company_name,
                company_tier: item.company_tier,
                product_type: item.product_type,
                order_age_days: ageDays,
                pending_quantity: pendingQty,
                committed_dispatch_date: item.committed_dispatch_date,
                commitment_status: item.commitment_status,
                commitment_points: commitmentPoints,
                score: basePoints + agePoints + stockPenalty + commitmentPoints,
                status: item.allocated_quantity > 0 ? 'Partially Allocated' : 'Received'
            });
        }
        recommPool.sort((a, b) => b.score - a.score);

        // Relationship risk companies
        const riskCompanies = await queryAll(
            `SELECT id, name, tier, commitment_health_score, relationship_risk_flag
             FROM companies WHERE relationship_risk_flag = 1`
        );

        // Missed commitments today
        const missedToday = await queryAll(
            `SELECT po.id, po.committed_dispatch_date, po.commitment_status, c.name as company_name, c.tier as company_tier
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             WHERE po.commitment_status = 'Missed' AND po.status NOT IN ('Dispatched', 'Closed')`
        );

        res.json({
            system_date: systemDate,
            unconfirmed_snapshots_count: unconfirmedCount,
            open_po_tier_counts: tierCounts,
            inventory_statuses: stockStatuses,
            anomalous_pos: anomalousPOs,
            shortage_alerts: shortageAlerts,
            forward_projections: forwardProjections,
            actionable_po_pool: recommPool,
            relationship_risk_companies: riskCompanies,
            missed_commitments: missedToday
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 8. Morning Brief Endpoint
// ==========================================
app.get('/api/dashboard/morning-brief', async (req, res) => {
    try {
        const systemDate = await getSystemDate();
        await syncPOCommitmentStatuses(systemDate);

        const criticalAlerts = [];

        // a) Missed commitments
        const missed = await queryAll(
            `SELECT po.id, po.committed_dispatch_date, c.name as company_name, c.tier
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             WHERE po.commitment_status = 'Missed' AND po.status NOT IN ('Dispatched', 'Closed')`
        );
        missed.forEach(m => {
            criticalAlerts.push({ type: 'missed_commitment', po_id: m.id, company_name: m.company_name, tier: m.tier, date: m.committed_dispatch_date });
        });

        // b) Critical stock below threshold
        const thresholds = await getInventoryThresholds();
        const stockRows = await queryAll("SELECT product_type, closing_stock FROM inventory_snapshots WHERE date = ?", [systemDate]);
        const stockMap = {};
        stockRows.forEach(r => { stockMap[r.product_type] = r.closing_stock; });
        ['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene'].forEach(prod => {
            const stock = stockMap[prod] || 0;
            const minT = thresholds[prod] || 0;
            if (stock < minT) {
                criticalAlerts.push({ type: 'stock_critical', product: prod, stock, threshold: minT });
            }
        });

        // c) Relationship risk companies
        const riskCos = await queryAll(
            "SELECT name, tier, commitment_health_score FROM companies WHERE relationship_risk_flag = 1"
        );
        riskCos.forEach(c => {
            criticalAlerts.push({ type: 'relationship_risk', company_name: c.name, tier: c.tier, health_score: c.commitment_health_score });
        });

        // d) Unconfirmed snapshot banners
        const unconfirmedCount = await getUnconfirmedSnapshotsCount(systemDate);
        if (unconfirmedCount > 0) {
            criticalAlerts.push({ type: 'unconfirmed_snapshots', count: unconfirmedCount });
        }

        // Top 5 dispatch recommendations
        const topRecs = await queryAll(
            `SELECT li.po_id, po.committed_dispatch_date, po.commitment_status, c.name as company_name, c.tier as company_tier, li.product_type,
             (li.quantity - li.allocated_quantity) as pending_qty
             FROM po_line_items li
             JOIN purchase_orders po ON li.po_id = po.id
             JOIN companies c ON po.company_id = c.id
             WHERE po.status IN ('Received', 'Partially Allocated') AND (li.quantity - li.allocated_quantity) > 0
             LIMIT 5`
        );

        // Recent planner activity (last 10 dispatches)
        const recentActivity = await queryAll(
            `SELECT id, product_type, quantity, vehicle_id, planned_dispatch_date, status, created_by, created_at
             FROM dispatch_log ORDER BY created_at DESC LIMIT 10`
        );

        // Flat arrays for easy Dashboard component consumption
        const missedCommitments = missed.map(m => ({
            po_id: m.id,
            company_name: m.company_name,
            company_tier: m.tier,
            committed_dispatch_date: m.committed_dispatch_date
        }));
        const riskCompanies = riskCos.map(c => ({
            name: c.name,
            tier: c.tier,
            commitment_health_score: c.commitment_health_score
        }));
        const shortageAlerts = criticalAlerts.filter(a => a.type === 'stock_critical').map(a => ({
            product_type: a.product,
            stock: a.stock,
            min_threshold: a.threshold
        }));

        res.json({
            system_date: systemDate,
            critical_alerts: criticalAlerts,
            top_recommendations: topRecs,
            recent_activity: recentActivity,
            // Flat convenience arrays
            missed_commitments: missedCommitments,
            relationship_risk_companies: riskCompanies,
            shortage_alerts: shortageAlerts
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 9. What-If Scenario Simulator Endpoints
// ==========================================
app.get('/api/scenarios', async (req, res) => {
    try {
        const rows = await queryAll("SELECT * FROM scenario_snapshots ORDER BY created_at DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/scenarios', async (req, res) => {
    try {
        const { name, snapshot_json, ai_narration, created_by } = req.body;
        if (!name || !snapshot_json) {
            return res.status(400).json({ error: 'Scenario name and snapshot data are required.' });
        }
        const result = await queryRun(
            `INSERT INTO scenario_snapshots (name, snapshot_json, ai_narration, created_by) VALUES (?, ?, ?, ?)`,
            [name, typeof snapshot_json === 'string' ? snapshot_json : JSON.stringify(snapshot_json),
             ai_narration || null, created_by || 'Planner']
        );
        res.json({ success: true, id: result.lastID || result.lastId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/scenarios/:id', async (req, res) => {
    try {
        const row = await queryGet("SELECT * FROM scenario_snapshots WHERE id = ?", [req.params.id]);
        if (!row) return res.status(404).json({ error: 'Scenario not found.' });
        res.json({ ...row, snapshot_json: JSON.parse(row.snapshot_json) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/scenarios/:id', async (req, res) => {
    try {
        await queryRun("DELETE FROM scenario_snapshots WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 9b. Excel Data Import Endpoint (Phase 2 Extension)
// ==========================================
app.post('/api/import', async (req, res) => {
    try {
        const { clear_existing, rows } = req.body;
        if (!Array.isArray(rows)) {
            return res.status(400).json({ error: 'Rows must be an array of objects.' });
        }

        console.log(`Starting import of ${rows.length} rows. Clear existing: ${clear_existing}`);

        // 1. Clear existing data if requested
        if (clear_existing) {
            await runInTransaction(async (tx) => {
                await tx.run("DELETE FROM dispatch_allocations");
                await tx.run("DELETE FROM dispatch_log");
                await tx.run("DELETE FROM po_line_items");
                await tx.run("DELETE FROM po_commitment_history");
                await tx.run("DELETE FROM purchase_orders");
                await tx.run("DELETE FROM customer_login_activity");
            });
            console.log('Cleared existing orders and dispatches.');
        }

        // Product mapping translation helper
        const PRODUCT_MAPPING = {
            'MTO': 'Toluene',
            'AA': 'Ethyl Acetate',
            'RETARDER': 'Retarder',
            'ACETONE': 'Acetone',
            'SL SHORT HS': 'Benzene',
            '200LTR SHAVI HS': 'Acetone',
            '50LTR SHAVI HS': 'DEP',
            'BENZENE': 'Benzene',
            'DEP': 'DEP',
            'ETHYL ACETATE': 'Ethyl Acetate',
            'TOLUENE': 'Toluene'
        };

        const mapProduct = (p) => {
            if (!p) return 'Acetone';
            const clean = String(p).trim().toUpperCase();
            return PRODUCT_MAPPING[clean] || 'Acetone';
        };

        // Cache for companies to avoid repeated lookups
        const companyCache = {};
        const existingCompanies = await queryAll("SELECT id, name FROM companies");
        for (const c of existingCompanies) {
            companyCache[c.name.toLowerCase().trim()] = c.id;
        }

        // Helper to parse dates
        const parseExcelDate = (val) => {
            if (!val) return null;
            if (val instanceof Date) {
                return val.toISOString().split('T')[0];
            }
            if (typeof val === 'number') {
                const date = new Date(Math.round((val - 25569) * 86400 * 1000));
                return date.toISOString().split('T')[0];
            }
            if (typeof val === 'string') {
                const parts = val.split('-');
                if (parts.length === 3) {
                    const p0 = parts[0].trim();
                    const p1 = parts[1].trim();
                    const p2 = parts[2].trim();
                    if (p0.length <= 2 && p1.length <= 2 && p2.length === 4) {
                        return `${p2}-${p1.padStart(2, '0')}-${p0.padStart(2, '0')}`;
                    }
                    if (p0.length === 4 && p1.length <= 2 && p2.length <= 2) {
                        return `${p0}-${p1.padStart(2, '0')}-${p2.padStart(2, '0')}`;
                    }
                }
                try {
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) {
                        return d.toISOString().split('T')[0];
                    }
                } catch (e) {}
            }
            return null;
        };

        let newCompanyCount = 0;
        let poCount = 0;
        let dispatchCount = 0;

        await runInTransaction(async (tx) => {
            const poCreated = new Set();
            const dispatchCreated = new Set();

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rawCompany = row["Company"] || row["company"];
                const rawProduct = row["Product"] || row["product"];
                const rawPOId = row["PO No."] || row["po_no"] || row["PO No"];
                const rawPODate = row["PO Date"] || row["po_date"];
                const rawInvNo = row["Inv. No."] || row["inv_no"] || row["Inv No."] || row["Inv No"];
                const rawInvDate = row["Inv. Date"] || row["inv_date"];
                const rawQty = parseFloat(row["Quantity"] || row["quantity"] || 0);

                if (!rawCompany || !rawProduct || isNaN(rawQty) || rawQty <= 0) continue;

                const cleanCoName = String(rawCompany).trim();
                const coNameKey = cleanCoName.toLowerCase();
                let companyId = companyCache[coNameKey];

                if (!companyId) {
                    const suffix = String(Object.keys(companyCache).length + 1).padStart(3, '0');
                    companyId = `COMP-NEW-${suffix}`;
                    companyCache[coNameKey] = companyId;

                    const mappedProducts = JSON.stringify([mapProduct(rawProduct)]);
                    await tx.run(
                        `INSERT INTO companies (id, name, tier, primary_products, contact_person, contact_phone, credit_status, portal_login_enabled)
                         VALUES (?, ?, 'C', ?, 'Imported Client', '+91-00000-00000', 'Active', 0)`,
                        [companyId, cleanCoName, mappedProducts]
                    );
                    newCompanyCount++;
                }

                const poDate = parseExcelDate(rawPODate) || '2026-06-01';
                const invDate = parseExcelDate(rawInvDate) || poDate;

                const poId = rawPOId ? String(rawPOId).trim() : `PO-IMPORT-${i}`;
                const mappedProd = mapProduct(rawProduct);

                if (!poCreated.has(poId)) {
                    poCreated.add(poId);
                    await tx.run(
                        `INSERT INTO purchase_orders (id, company_id, date_received, committed_dispatch_date, commitment_status, status, notes, created_by)
                         VALUES (?, ?, ?, ?, 'Honored', 'Closed', ?, 'Excel Import')`,
                        [poId, companyId, poDate, invDate, `Imported from Excel Row ${i + 1}`]
                    );
                    await tx.run(
                        `INSERT INTO po_commitment_history (po_id, committed_date, status, reason)
                         VALUES (?, ?, 'Honored', 'Initial commitment imported from Excel')`,
                        [poId, invDate]
                    );
                    poCount++;
                }

                await tx.run(
                    `INSERT INTO po_line_items (po_id, product_type, quantity, allocated_quantity)
                     VALUES (?, ?, ?, ?)`,
                    [poId, mappedProd, rawQty, rawQty]
                );

                const lineItemRow = await tx.get(
                    "SELECT id FROM po_line_items WHERE po_id = ? AND product_type = ? ORDER BY id DESC LIMIT 1",
                    [poId, mappedProd]
                );
                const lineItemId = lineItemRow ? lineItemRow.id : null;

                if (rawInvNo) {
                    const cleanInvNo = String(rawInvNo).trim();
                    const dspId = `DSP-${cleanInvNo}`;

                    if (!dispatchCreated.has(dspId)) {
                        dispatchCreated.add(dspId);
                        await tx.run(
                            `INSERT INTO dispatch_log (id, product_type, quantity, vehicle_id, planned_dispatch_date, actual_dispatch_date, status)
                             VALUES (?, ?, ?, 'VEH-IMPORT', ?, ?, 'Executed')`,
                            [dspId, mappedProd, rawQty, poDate, invDate]
                        );
                        dispatchCount++;
                    }

                    if (lineItemId) {
                        await tx.run(
                            `INSERT INTO dispatch_allocations (dispatch_id, po_id, po_line_item_id, quantity)
                             VALUES (?, ?, ?, ?)`,
                            [dspId, poId, lineItemId, rawQty]
                        );
                    }
                }
            }
        });

        // Recalculate company scores
        const systemDate = await getSystemDate();
        await syncPOCommitmentStatuses(systemDate);

        res.json({
            success: true,
            summary: {
                total_rows: rows.length,
                new_companies: newCompanyCount,
                purchase_orders: poCount,
                dispatches: dispatchCount
            }
        });
    } catch (err) {
        console.error('Import error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 9c. Vendor Purchases Excel Import Endpoint (Phase 2 Extension)
// ==========================================
app.post('/api/import-purchases', async (req, res) => {
    try {
        const { clear_existing, rows } = req.body;
        if (!Array.isArray(rows)) {
            return res.status(400).json({ error: 'Rows must be an array of objects.' });
        }

        console.log(`Starting import of ${rows.length} vendor purchase rows. Clear existing: ${clear_existing}`);

        // Helper to parse dates
        const parseExcelDate = (val) => {
            if (!val) return null;
            if (val instanceof Date) {
                return val.toISOString().split('T')[0];
            }
            if (typeof val === 'number') {
                const date = new Date(Math.round((val - 25569) * 86400 * 1000));
                return date.toISOString().split('T')[0];
            }
            if (typeof val === 'string') {
                const parts = val.split('-');
                if (parts.length === 3) {
                    const p0 = parts[0].trim();
                    const p1 = parts[1].trim();
                    const p2 = parts[2].trim();
                    if (p0.length <= 2 && p1.length <= 2 && p2.length === 4) {
                        return `${p2}-${p1.padStart(2, '0')}-${p0.padStart(2, '0')}`;
                    }
                    if (p0.length === 4 && p1.length <= 2 && p2.length <= 2) {
                        return `${p0}-${p1.padStart(2, '0')}-${p2.padStart(2, '0')}`;
                    }
                }
                try {
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) {
                        return d.toISOString().split('T')[0];
                    }
                } catch (e) {}
            }
            return null;
        };

        // Material translation dictionary
        const mapMaterialToProduct = (m) => {
            if (!m) return 'Other';
            const clean = String(m).trim().toLowerCase();
            if (clean.includes('acetone')) return 'Acetone';
            if (clean.includes('methanol')) return 'Benzene';
            if (clean.includes('alcohol') || clean.includes('alocohal')) return 'Retarder';
            if (clean.includes('toluene')) return 'Toluene';
            if (clean.includes('benzene')) return 'Benzene';
            if (clean.includes('ethyl acetate')) return 'Ethyl Acetate';
            if (clean.includes('dep')) return 'DEP';
            return 'Other';
        };

        await runInTransaction(async (tx) => {
            // 1. Clear existing raw purchases if requested
            if (clear_existing) {
                await tx.run("DELETE FROM vendor_purchases");
                // Reset all purchased material received in snapshots to 0
                await tx.run("UPDATE inventory_snapshots SET purchased_material_received = 0");
                console.log('Cleared existing vendor purchases and reset inventory snapshot purchase receipts.');
            }

            // 2. Insert raw rows and aggregate quantities
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rawDate = row["Date"] || row["date"];
                const rawInvNo = row["Inv. No."] || row["inv_no"] || row["Inv No."] || row["Inv No"];
                const rawVendor = row["Vendor"] || row["vendor"];
                const rawMaterial = row["Material"] || row["material"];
                const rawQty = parseFloat(String(row["Quantity"] || row["quantity"] || 0).replace(/,/g, ''));
                const rawRate = parseFloat(String(row["Rate"] || row["rate"] || 0).replace(/,/g, ''));
                const rawAmt = parseFloat(String(row["Amount"] || row["amount"] || 0).replace(/,/g, ''));

                if (!rawVendor || !rawMaterial || isNaN(rawQty) || rawQty <= 0) continue;

                const parsedDate = parseExcelDate(rawDate);
                if (!parsedDate) continue;

                const mappedProduct = mapMaterialToProduct(rawMaterial);

                // Insert vendor purchase log
                await tx.run(
                    `INSERT INTO vendor_purchases (date, invoice_no, vendor, material, quantity, rate, amount, mapped_product)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [parsedDate, rawInvNo ? String(rawInvNo).trim() : null, String(rawVendor).trim(), String(rawMaterial).trim(), rawQty, isNaN(rawRate) ? null : rawRate, isNaN(rawAmt) ? null : rawAmt, mappedProduct]
                );

                // If mapped to a standard product, update the corresponding inventory snapshot
                if (mappedProduct !== 'Other') {
                    const snapId = `${mappedProduct}_${parsedDate}`;
                    const existingSnap = await tx.get("SELECT id, opening_stock, production_added, dispatched_out, purchased_material_received FROM inventory_snapshots WHERE id = ?", [snapId]);

                    if (existingSnap) {
                        const newPurRec = existingSnap.purchased_material_received + rawQty;
                        const newClosing = Math.max(0, existingSnap.opening_stock + existingSnap.production_added + newPurRec - existingSnap.dispatched_out);
                        await tx.run(
                            `UPDATE inventory_snapshots 
                             SET purchased_material_received = ?, closing_stock = ?, updated_at = CURRENT_TIMESTAMP 
                             WHERE id = ?`,
                            [newPurRec, newClosing, snapId]
                        );
                    } else {
                        // Create a placeholder snapshot for this date
                        // Find opening stock from previous day closing
                        const prevDate = new Date(parsedDate);
                        prevDate.setDate(prevDate.getDate() - 1);
                        const prevDateStr = prevDate.toISOString().split('T')[0];
                        const prevSnap = await tx.get("SELECT closing_stock FROM inventory_snapshots WHERE product_type = ? AND date = ?", [mappedProduct, prevDateStr]);
                        const opStock = prevSnap ? prevSnap.closing_stock : 0.0;
                        const clStock = opStock + rawQty;

                        await tx.run(
                            `INSERT INTO inventory_snapshots (id, product_type, date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed)
                             VALUES (?, ?, ?, ?, 0.0, ?, 0.0, ?, 0)`,
                            [snapId, mappedProduct, parsedDate, opStock, rawQty, clStock]
                        );
                    }
                }
            }

            // 3. Recalculate opening/closing stocks chronologically for all products to keep snapshots fully consistent!
            const products = ['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene'];
            for (const prod of products) {
                const snaps = await tx.all("SELECT * FROM inventory_snapshots WHERE product_type = ? ORDER BY date ASC", [prod]);
                let lastClosingStock = snaps.length > 0 ? snaps[0].opening_stock : 0.0;

                for (let j = 0; j < snaps.length; j++) {
                    const snap = snaps[j];
                    const opStock = j === 0 ? snap.opening_stock : lastClosingStock;
                    const clStock = Math.max(0, opStock + snap.production_added + snap.purchased_material_received - snap.dispatched_out);
                    
                    await tx.run(
                        `UPDATE inventory_snapshots 
                         SET opening_stock = ?, closing_stock = ?, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = ?`,
                        [opStock, clStock, snap.id]
                    );
                    lastClosingStock = clStock;
                }
            }
        });

        // Query count of imported rows to return summary
        const summaryCount = await queryGet("SELECT COUNT(*) as count FROM vendor_purchases");
        const uniqueVendors = await queryGet("SELECT COUNT(DISTINCT vendor) as count FROM vendor_purchases");

        res.json({
            success: true,
            summary: {
                total_rows: rows.length,
                inserted_purchases: summaryCount ? summaryCount.count : 0,
                unique_vendors: uniqueVendors ? uniqueVendors.count : 0
            }
        });
    } catch (err) {
        console.error('Vendor import error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 10. Customer Portal Endpoints
// ==========================================

// Customer login
app.post('/api/customer/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password required.' });
        }
        const user = await queryGet(
            "SELECT * FROM customer_portal_users WHERE username = ? AND is_active = 1",
            [username]
        );
        if (!user) {
            return res.json({ success: false, error: 'Invalid credentials.' });
        }

        // Simple plaintext match (production would use bcrypt)
        if (user.password !== password) {
            return res.json({ success: false, error: 'Invalid credentials.' });
        }

        // Log login activity
        try {
            await queryRun(
                "INSERT INTO customer_login_activity (company_id) VALUES (?)",
                [user.company_id]
            );
        } catch (logErr) {
            // Non-critical — log and continue
            console.warn('Login activity log failed:', logErr.message);
        }

        // Get company info
        const company = await queryGet("SELECT name, tier FROM companies WHERE id = ?", [user.company_id]);

        // Return user info (exclude password)
        const { password: _pwd, ...safeUser } = user;
        res.json({
            success: true,
            user: {
                ...safeUser,
                company_name: company?.name || null,
                company_tier: company?.tier || null,
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// Get orders for a specific customer company
app.get('/api/customer/orders/:company_id', async (req, res) => {
    try {
        const { company_id } = req.params;
        const pos = await queryAll(
            `SELECT po.id, po.date_received, po.status, po.committed_dispatch_date, po.commitment_status, po.notes,
             c.name as company_name
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             WHERE po.company_id = ?
             ORDER BY po.date_received DESC`,
            [company_id]
        );

        const result = [];
        for (const po of pos) {
            const items = await queryAll("SELECT product_type, quantity, allocated_quantity FROM po_line_items WHERE po_id = ?", [po.id]);
            const dispatches = await queryAll(
                `SELECT dl.vehicle_id, dl.planned_dispatch_date, dl.actual_dispatch_date, dl.status, da.quantity
                 FROM dispatch_allocations da
                 JOIN dispatch_log dl ON da.dispatch_id = dl.id
                 WHERE da.po_id = ?`,
                [po.id]
            );
            result.push({ ...po, items, dispatches });
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single order detail for customer
app.get('/api/customer/orders/:company_id/:po_id', async (req, res) => {
    try {
        const { company_id, po_id } = req.params;
        const po = await queryGet(
            `SELECT po.*, c.name as company_name
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             WHERE po.id = ? AND po.company_id = ?`,
            [po_id, company_id]
        );
        if (!po) return res.status(404).json({ error: 'Order not found.' });

        const items = await queryAll("SELECT * FROM po_line_items WHERE po_id = ?", [po_id]);
        const dispatches = await queryAll(
            `SELECT dl.vehicle_id, dl.planned_dispatch_date, dl.actual_dispatch_date, dl.status, da.quantity, dl.product_type
             FROM dispatch_allocations da
             JOIN dispatch_log dl ON da.dispatch_id = dl.id
             WHERE da.po_id = ?`,
            [po_id]
        );
        const history = await queryAll(
            "SELECT * FROM po_commitment_history WHERE po_id = ? ORDER BY timestamp ASC",
            [po_id]
        );

        res.json({ ...po, items, dispatches, commitment_history: history });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get customer portal users for a company (admin use)
app.get('/api/customer/users/:company_id', async (req, res) => {
    try {
        const rows = await queryAll(
            "SELECT id, username, full_name, is_active, created_at FROM customer_portal_users WHERE company_id = ?",
            [req.params.company_id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create customer portal user
app.post('/api/customer/users', async (req, res) => {
    try {
        const { company_id, username, password, full_name, email } = req.body;
        if (!company_id || !username || !password) {
            return res.status(400).json({ error: 'company_id, username, and password are required.' });
        }
        // Enable portal for the company
        await queryRun(
            "UPDATE companies SET portal_login_enabled = 1 WHERE id = ?",
            [company_id]
        );
        await queryRun(
            "INSERT INTO customer_portal_users (company_id, username, password, full_name) VALUES (?, ?, ?, ?)",
            [company_id, username, password, full_name || '']
        );
        res.json({ success: true, message: 'Portal user created.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 11. Commitment Health Dashboard Endpoint
// ==========================================
app.get('/api/commitment-health', async (req, res) => {
    try {
        const systemDate = await getSystemDate();
        await syncPOCommitmentStatuses(systemDate);

        const companies = await queryAll(
            `SELECT c.id, c.name, c.tier, c.commitment_health_score, c.relationship_risk_flag,
             COUNT(po.id) as total_commitments,
             SUM(CASE WHEN po.commitment_status = 'Honored' THEN 1 ELSE 0 END) as honored,
             SUM(CASE WHEN po.commitment_status = 'Missed' THEN 1 ELSE 0 END) as missed,
             SUM(CASE WHEN po.commitment_status = 'Renegotiated' THEN 1 ELSE 0 END) as renegotiated,
             SUM(CASE WHEN po.commitment_status = 'Pending' THEN 1 ELSE 0 END) as pending
             FROM companies c
             LEFT JOIN purchase_orders po ON po.company_id = c.id AND po.committed_dispatch_date IS NOT NULL
             GROUP BY c.id
             ORDER BY c.relationship_risk_flag DESC, c.commitment_health_score ASC`
        );

        const overallMissed = await queryAll(
            `SELECT po.id, po.committed_dispatch_date, po.commitment_status, c.name as company_name, c.tier,
             c.commitment_health_score
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             WHERE po.commitment_status = 'Missed'
             ORDER BY po.committed_dispatch_date ASC`
        );

        res.json({
            system_date: systemDate,
            companies,
            missed_pos: overallMissed
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 12. Reports Endpoints
// ==========================================
app.get('/api/reports', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'Start Date and End Date parameters are required.' });
        }

        // REPORT A: Monthly Dispatch Summary
        const rawMonthly = await queryAll(
            `SELECT 
                c.name as company_name, 
                dl.product_type,
                dl.actual_dispatch_date,
                SUM(dl.quantity) as total_dispatched_qty
             FROM dispatch_log dl
             JOIN dispatch_allocations da ON dl.id = da.dispatch_id
             JOIN purchase_orders po ON da.po_id = po.id
             JOIN companies c ON po.company_id = c.id
             WHERE dl.status = 'Executed' AND dl.actual_dispatch_date BETWEEN ? AND ?
             GROUP BY c.id, c.name, dl.product_type, dl.actual_dispatch_date
             ORDER BY c.name ASC`,
            [start_date, end_date]
        );

        // Group by month in Javascript to prevent SQLite/Postgres strftime differences
        const monthlyMap = {};
        for (const row of rawMonthly) {
            const dateStr = String(row.actual_dispatch_date);
            const month = dateStr.substring(0, 7); // YYYY-MM
            const key = `${row.company_name}_${row.product_type}_${month}`;
            
            if (!monthlyMap[key]) {
                // Fetch pending balance
                const pendingRow = await queryGet(
                    `SELECT SUM(li.quantity - li.allocated_quantity) as pending_bal
                     FROM po_line_items li 
                     JOIN purchase_orders po ON li.po_id = po.id
                     JOIN companies c ON po.company_id = c.id
                     WHERE c.name = ? AND li.product_type = ? AND po.status IN ('Received', 'Partially Allocated')`,
                    [row.company_name, row.product_type]
                );
                
                monthlyMap[key] = {
                    company_name: row.company_name,
                    product_type: row.product_type,
                    month: month,
                    total_dispatched_qty: 0,
                    pending_balance: pendingRow && pendingRow.pending_bal ? parseFloat(pendingRow.pending_bal) : 0
                };
            }
            monthlyMap[key].total_dispatched_qty += parseFloat(row.total_dispatched_qty);
        }
        const monthlySummary = Object.values(monthlyMap);

        // REPORT B: Inventory Movement Report
        const inventoryMovement = await queryAll(
            `SELECT product_type, date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed
             FROM inventory_snapshots
             WHERE date BETWEEN ? AND ?
             ORDER BY date DESC, product_type ASC`,
            [start_date, end_date]
        );

        // REPORT C: PO Fulfillment Rate
        const fulfillmentRows = await queryAll(
            `SELECT 
                po.id as po_id,
                c.tier as company_tier,
                po.date_received,
                dl.actual_dispatch_date,
                li.quantity as ordered_qty,
                da.quantity as allocated_qty,
                dl.status as dispatch_status
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             JOIN po_line_items li ON po.id = li.po_id
             LEFT JOIN dispatch_allocations da ON po.id = da.po_id AND li.id = da.po_line_item_id
             LEFT JOIN dispatch_log dl ON da.dispatch_id = dl.id
             WHERE po.date_received BETWEEN ? AND ?`,
            [start_date, end_date]
        );

        const tierFulfillment = {
            A: { total_po_lines: 0, met_7d: 0, met_14d: 0, met_30d: 0 },
            B: { total_po_lines: 0, met_7d: 0, met_14d: 0, met_30d: 0 },
            C: { total_po_lines: 0, met_7d: 0, met_14d: 0, met_30d: 0 }
        };

        fulfillmentRows.forEach(row => {
            const tier = row.company_tier;
            if (!tierFulfillment[tier]) return;

            tierFulfillment[tier].total_po_lines++;

            if (row.dispatch_status === 'Executed' && row.actual_dispatch_date) {
                const rec = new Date(row.date_received);
                const disp = new Date(row.actual_dispatch_date);
                const diffDays = Math.max(0, Math.floor((disp - rec) / (1000 * 60 * 60 * 24)));

                if (diffDays <= 7) tierFulfillment[tier].met_7d++;
                if (diffDays <= 14) tierFulfillment[tier].met_14d++;
                if (diffDays <= 30) tierFulfillment[tier].met_30d++;
            }
        });

        const fulfillmentSummary = Object.entries(tierFulfillment).map(([tier, stats]) => {
            const total = stats.total_po_lines || 1;
            return {
                tier,
                total_orders: stats.total_po_lines,
                rate_7d: parseFloat(((stats.met_7d / total) * 100).toFixed(1)),
                rate_14d: parseFloat(((stats.met_14d / total) * 100).toFixed(1)),
                rate_30d: parseFloat(((stats.met_30d / total) * 100).toFixed(1))
            };
        });

        // REPORT D: AI vs Actual Dispatch Quantities
        const aiVsActual = await queryAll(
            `SELECT 
                date,
                product_type,
                SUM(rec_qty) as ai_recommended_qty,
                SUM(act_qty) as actual_dispatched_qty
             FROM (
                SELECT 
                    planned_dispatch_date as date, 
                    product_type, 
                    SUM(quantity) as rec_qty,
                    0 as act_qty
                FROM dispatch_log
                WHERE vehicle_id LIKE 'RUN-%'
                GROUP BY planned_dispatch_date, product_type
                
                UNION ALL
                
                SELECT 
                    actual_dispatch_date as date, 
                    product_type, 
                    0 as rec_qty,
                    SUM(quantity) as act_qty
                FROM dispatch_log
                WHERE status = 'Executed' AND actual_dispatch_date IS NOT NULL
                GROUP BY actual_dispatch_date, product_type
             ) combined
             WHERE date BETWEEN ? AND ?
             GROUP BY date, product_type
             ORDER BY date DESC, product_type ASC`,
            [start_date, end_date]
        );

        res.json({
            monthly_summary: monthlySummary,
            inventory_movement: inventoryMovement,
            fulfillment_rate: fulfillmentSummary,
            ai_vs_actual: aiVsActual
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 9. AI Dispatch Agent (Conversational API)
// ==========================================
app.post('/api/ai-chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message content is required.' });
        }

        const systemDate = await getSystemDate();
        const thresholds = await getInventoryThresholds();
        
        const keyRow = await queryGet("SELECT value FROM system_settings WHERE key = 'anthropic_api_key'");
        const apiKey = keyRow ? keyRow.value : process.env.ANTHROPIC_API_KEY;

        const stockRows = await queryAll("SELECT product_type, closing_stock FROM inventory_snapshots WHERE date = ?", [systemDate]);
        const currentStocks = {};
        stockRows.forEach(r => {
            currentStocks[r.product_type] = r.closing_stock;
        });

        const pendingPOs = await queryAll(
            `SELECT po.id, c.name as company, c.tier, li.product_type, (li.quantity - li.allocated_quantity) as pending_qty, po.date_received
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             JOIN po_line_items li ON po.id = li.po_id
             WHERE po.status IN ('Received', 'Partially Allocated') AND (li.quantity - li.allocated_quantity) > 0`
        );

        const productionPlans = await queryAll(
            `SELECT * FROM production_plans WHERE week_start_date >= ? ORDER BY week_start_date ASC LIMIT 12`,
            [systemDate]
        );

        const systemPrompt = `
You are the AI Dispatch Agent for a chemical solvent distribution business.
Products: Acetone, Benzene, DEP, Ethyl Acetate, Retarder, Toluene.

Current Simulated Date: ${systemDate}

Current Inventory Stock Levels:
${JSON.stringify(currentStocks, null, 2)}

Configured Safety Stock Minimum Thresholds:
${JSON.stringify(thresholds, null, 2)}

Pending Purchase Orders (Unfulfilled Demand):
${JSON.stringify(pendingPOs, null, 2)}

Production Plans:
${JSON.stringify(productionPlans, null, 2)}

Guidelines:
1. You answer logistics planning questions about stock levels, PO priorities, dispatch orders, and inventory projections.
2. You CANNOT directly execute dispatches, edit POs, or modify settings. You only analyze and recommend actions.
3. Be professional, direct, and density-oriented. Give detailed, structured quantitative analysis, listing exact figures and reasoning. Do not make generic customer-focused statements. Speak like an expert SAP/SCM supply chain consultant.
`;

        if (apiKey && apiKey.trim() !== '') {
            console.log('Calling Anthropic Claude API...');
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 1024,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: message }
                    ]
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Claude API request failed: ${errText}`);
            }

            const data = await response.json();
            return res.json({
                response: data.content[0].text,
                provider: 'Claude API'
            });
        } else {
            console.log('No Anthropic API Key found. Simulating response...');
            const simResponse = simulateAIResponse(message, systemDate, currentStocks, thresholds, pendingPOs, productionPlans);
            return res.json({
                response: simResponse,
                provider: 'Simulated AI Dispatch Agent (Local Rules Engine)'
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper to simulate smart answers
function simulateAIResponse(message, systemDate, stocks, thresholds, pendingPOs, productionPlans) {
    const msg = message.toLowerCase();
    
    if (msg.includes('dispatch') && (msg.includes('today') || msg.includes('which customer') || msg.includes('order'))) {
        const activeList = pendingPOs.map(po => {
            const rec = new Date(po.date_received);
            const sys = new Date(systemDate);
            const ageDays = Math.max(0, Math.floor((sys - rec) / (1000 * 60 * 60 * 24)));
            let base = po.tier === 'A' ? 100 : po.tier === 'B' ? 60 : 20;
            let agePts = Math.min(40, ageDays * 2);
            let penalty = (stocks[po.product_type] || 0) < po.pending_qty ? -30 : 0;
            return {
                ...po,
                score: base + agePts + penalty,
                age: ageDays,
                stock: stocks[po.product_type] || 0
            };
        }).sort((a, b) => b.score - a.score);

        if (activeList.length === 0) {
            return `No pending purchase orders require dispatch allocations today. All order queues are fully satisfied.`;
        }

        let resp = `### Today's Dispatch Prioritization Recommendation (${systemDate})\n\n`;
        resp += `Based on the deterministic prioritization algorithm (Tier Weight + Age Points - Stock Deficit Penalty), here are the top orders recommended for allocation:\n\n`;
        
        activeList.forEach((po, index) => {
            resp += `${index + 1}. **${po.company}** (Tier ${po.tier}) — **PO ID: ${po.id}**\n`;
            resp += `   - Product: **${po.product_type}** | Quantity: **${po.pending_qty} MT**\n`;
            resp += `   - Order Age: **${po.age} Days** | Priority Score: **${po.score} pts**\n`;
            resp += `   - Inventory Availability: **${po.stock} MT** current stock.\n`;
            if (po.stock < po.pending_qty) {
                resp += `   - *Warning: Current stock is insufficient. Deducted 30 pts stock penalty.*\n`;
            }
            resp += `\n`;
        });
        
        resp += `\n**Consolidation Recommendation**: You can bundle these allocations into vehicle runs using the **Run Optimizer** on the *Dispatch Planning* tab. Runs default to 32 MT.`;
        return resp;
    }

    if (msg.includes('acetone') && msg.includes('remain') && msg.includes('tier a')) {
        const acetoneA = pendingPOs
            .filter(po => po.product_type === 'Acetone' && po.tier === 'A')
            .reduce((acc, curr) => acc + curr.pending_qty, 0);
        
        const currentStock = stocks['Acetone'] || 0.0;
        const remaining = Math.max(0, currentStock - acetoneA);
        const threshold = thresholds['Acetone'] || 50.0;
        
        let resp = `### Acetone Tier A Fulfillment Projection\n\n`;
        resp += `- Current Acetone Stock: **${currentStock} MT**\n`;
        resp += `- Total Pending Tier A Acetone Demand: **${acetoneA} MT**\n`;
        resp += `- Projected Closing Stock: **${remaining.toFixed(2)} MT**\n`;
        resp += `- Configured Minimum Safety Threshold: **${threshold} MT**\n\n`;

        if (remaining < threshold) {
            resp += `⚠️ **Risk Flag**: Fulfilling all Tier A Acetone orders will push stock down to **${remaining.toFixed(2)} MT**, which violates the minimum safety stock limit of **${threshold} MT** by **${(threshold - remaining).toFixed(2)} MT**. Production replenishment should be scheduled immediately.`;
        } else {
            resp += `✅ **Inventory Healthy**: Remaining projected stock of **${remaining.toFixed(2)} MT** will be sufficient and remains above the safety threshold of **${threshold} MT**.`;
        }
        return resp;
    }

    if (msg.includes('benzene') && msg.includes('punjab') && msg.includes('thursday')) {
        const punjabBenzene = pendingPOs
            .filter(po => po.company.includes('Punjab') && po.product_type === 'Benzene')
            .reduce((acc, curr) => acc + curr.pending_qty, 0);

        const currentStock = stocks['Benzene'] || 0.0;
        const weeklyPlanned = productionPlans.find(p => p.product_type === 'Benzene')?.planned_quantity || 30.0;
        const dailyProd = weeklyPlanned / 7.0;
        const projectedStockIn7Days = currentStock + (dailyProd * 7) - punjabBenzene;
        const threshold = thresholds['Benzene'] || 40.0;

        let resp = `### Benzene Projection for Punjab Chemicals (7 Days Out)\n\n`;
        resp += `- Current Benzene Stock: **${currentStock} MT**\n`;
        resp += `- Punjab Chemicals Benzene Demand: **${punjabBenzene} MT**\n`;
        resp += `- Estimated Production Replenishment (7 Days): **+${(dailyProd * 7).toFixed(1)} MT** (based on Weekly Plan of ${weeklyPlanned} MT)\n`;
        resp += `- Projected Stock after Fulfilling Punjab: **${projectedStockIn7Days.toFixed(2)} MT**\n`;
        resp += `- Safety Threshold: **${threshold} MT**\n\n`;

        if (projectedStockIn7Days < threshold) {
            resp += `⚠️ **Alert**: Stock levels will drop below safety threshold to **${projectedStockIn7Days.toFixed(2)} MT** by next Thursday if Punjab Chemicals' order of **${punjabBenzene} MT** is fully dispatched without additional purchase receipt or boosted production runs.`;
        } else {
            resp += `✅ **Sufficient Stock**: Yes, the current stock plus scheduled weekly production is sufficient to cover Punjab's order and retain a safe margin of **${(projectedStockIn7Days - threshold).toFixed(1)} MT** above the safety threshold.`;
        }
        return resp;
    }

    if (msg.includes('risk') || msg.includes('stockout') || msg.includes('shortage')) {
        const lowProducts = [];
        for (const [prod, stock] of Object.entries(stocks)) {
            const minT = thresholds[prod] || 0.0;
            const pendingQty = pendingPOs
                .filter(po => po.product_type === prod)
                .reduce((acc, curr) => acc + curr.pending_qty, 0);

            if (stock < minT || (stock - pendingQty) < minT) {
                const affectedPOs = pendingPOs.filter(po => po.product_type === prod);
                lowProducts.push({
                    product: prod,
                    current_stock: stock,
                    threshold: minT,
                    deficit: Math.max(0, minT - (stock - pendingQty)),
                    affected_pos: affectedPOs
                });
            }
        }

        if (lowProducts.length === 0) {
            return `✅ **No Stockout Risks Identified**: All product inventories have sufficient coverage to absorb pending orders this week while remaining above minimum safety thresholds.`;
        }

        let resp = `### ⚠️ Supply Shortage & Stockout Risk Analysis (Current Week)\n\n`;
        resp += `The following products are projected to breach safety thresholds or face stockouts based on active pending orders:\n\n`;

        lowProducts.forEach(lp => {
            resp += `- **${lp.product}**:\n`;
            resp += `  - Current Stock: **${lp.current_stock} MT** (Threshold: ${lp.threshold} MT)\n`;
            resp += `  - Safety Deficit after PO fulfillment: **${lp.deficit.toFixed(2)} MT**\n`;
            resp += `  - **POs Affected**: ${lp.affected_pos.length > 0 ? lp.affected_pos.map(po => `\`${po.id}\` (${po.company})`).join(', ') : 'None'}\n\n`;
        });

        resp += `**Action Recommended**: Review production variance and schedule immediate emergency product runs or vendor purchases for products highlighted.`;
        return resp;
    }

    let defaultResp = `### AI Dispatch Agent Services System (${systemDate})\n\n`;
    defaultResp += `I have analyzed the active database parameters. Please ask specific logistics queries, such as:\n\n`;
    defaultResp += `1. *"Which customer orders should be dispatched today?"*\n`;
    defaultResp += `2. *"How much Acetone inventory will remain after fulfilling all Tier A POs?"*\n`;
    defaultResp += `3. *"Will we have enough Benzene for Punjab Chemicals' order by next Thursday?"*\n`;
    defaultResp += `4. *"Which POs are at risk of stockout this week?"*\n\n`;
    defaultResp += `Current Inventory overview: ${Object.entries(stocks).map(([k, v]) => `${k}: **${v} MT**`).join(', ')}.`;
    return defaultResp;
}

// Start backend server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Backend server listening on port ${PORT}`);
});
