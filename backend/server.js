import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getDbConnection, initDb } from './db.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Database on startup
initDb().then(() => {
    console.log('Database initialized successfully.');
}).catch(err => {
    console.error('Failed to initialize database:', err);
});

// Helper: Get active simulated date or actual date
async function getSystemDate(db) {
    const row = await db.get("SELECT value FROM system_settings WHERE key = 'system_date'");
    return row ? row.value : '2026-06-29';
}

// Helper: Get configurable thresholds
async function getInventoryThresholds(db) {
    const rows = await db.all("SELECT key, value FROM system_settings WHERE key LIKE 'min_threshold_%'");
    const thresholds = {};
    rows.forEach(r => {
        const prod = r.key.replace('min_threshold_', '');
        thresholds[prod] = parseFloat(r.value);
    });
    return thresholds;
}

// Helper: Check for unconfirmed snapshots
async function getUnconfirmedSnapshotsCount(db, systemDate) {
    const row = await db.get("SELECT COUNT(*) as count FROM inventory_snapshots WHERE date <= ? AND confirmed = 0", [systemDate]);
    return row ? row.count : 0;
}

// Helper: Calculate 90-day average for a company's order of a product type
async function getCompany90DayAverage(db, companyId, productType, systemDate) {
    const dateLimit = new Date(systemDate);
    dateLimit.setDate(dateLimit.getDate() - 90);
    const dateLimitStr = dateLimit.toISOString().split('T')[0];

    const row = await db.get(
        `SELECT AVG(li.quantity) as avg_qty 
         FROM po_line_items li
         JOIN purchase_orders po ON li.po_id = po.id
         WHERE po.company_id = ? AND li.product_type = ? AND po.status = 'Closed' AND po.date_received >= ?`,
        [companyId, productType, dateLimitStr]
    );
    return row && row.avg_qty ? parseFloat(row.avg_qty) : null;
}

// Helper: Calculate actual vs planned production variance ratio
async function getProductionPerformanceRatio(db, productType, systemDate) {
    const rows = await db.all(
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
        const db = await getDbConnection();
        const settings = await db.all("SELECT * FROM system_settings");
        await db.close();
        
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
        const db = await getDbConnection();
        const body = req.body;
        for (const [key, val] of Object.entries(body)) {
            await db.run(
                "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
                [key, String(val)]
            );
        }
        await db.close();
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
        const db = await getDbConnection();
        const rows = await db.all("SELECT * FROM companies ORDER BY name ASC");
        await db.close();
        res.json(rows.map(r => ({
            ...r,
            primary_products: JSON.parse(r.primary_products)
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
        
        const db = await getDbConnection();
        await db.run(
            `INSERT INTO companies (id, name, tier, primary_products, contact_person, contact_phone, credit_status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, name, tier, JSON.stringify(primary_products), contact_person || '', contact_phone || '', credit_status || 'Active', created_by || 'System']
        );
        await db.close();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/companies/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, tier, primary_products, contact_person, contact_phone, credit_status } = req.body;
        const db = await getDbConnection();
        await db.run(
            `UPDATE companies 
             SET name = ?, tier = ?, primary_products = ?, contact_person = ?, contact_phone = ?, credit_status = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [name, tier, JSON.stringify(primary_products), contact_person, contact_phone, credit_status, id]
        );
        await db.close();
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
        const db = await getDbConnection();
        const systemDate = await getSystemDate(db);
        
        const pos = await db.all(
            `SELECT po.*, c.name as company_name, c.tier as company_tier, c.credit_status as company_credit_status
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             ORDER BY po.date_received DESC`
        );

        const result = [];
        for (const po of pos) {
            const items = await db.all("SELECT * FROM po_line_items WHERE po_id = ?", [po.id]);
            
            // Calculate Order Age in days
            const recDate = new Date(po.date_received);
            const sysDateObj = new Date(systemDate);
            const ageDays = Math.max(0, Math.floor((sysDateObj - recDate) / (1000 * 60 * 60 * 24)));
            
            // Anomaly Detection: check if quantity > 2x 90-day average
            let isAnomalous = false;
            const itemSummaries = [];
            for (const item of items) {
                const avg90 = await getCompany90DayAverage(db, po.company_id, item.product_type, systemDate);
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
        
        await db.close();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = await getDbConnection();
        const systemDate = await getSystemDate(db);

        const po = await db.get(
            `SELECT po.*, c.name as company_name, c.tier as company_tier, c.credit_status as company_credit_status
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             WHERE po.id = ?`,
            [id]
        );

        if (!po) {
            await db.close();
            return res.status(404).json({ error: 'Purchase Order not found.' });
        }

        const items = await db.all("SELECT * FROM po_line_items WHERE po_id = ?", [id]);
        const itemDetails = [];
        for (const item of items) {
            const avg90 = await getCompany90DayAverage(db, po.company_id, item.product_type, systemDate);
            itemDetails.push({
                ...item,
                avg_90day: avg90,
                is_anomalous: avg90 !== null && item.quantity > 2 * avg90
            });
        }

        // Get allocations linked to this PO
        const allocations = await db.all(
            `SELECT da.*, dl.vehicle_id, dl.planned_dispatch_date, dl.actual_dispatch_date, dl.status as dispatch_status
             FROM dispatch_allocations da
             JOIN dispatch_log dl ON da.dispatch_id = dl.id
             WHERE da.po_id = ?`,
            [id]
        );

        await db.close();
        res.json({
            ...po,
            items: itemDetails,
            allocations
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pos', async (req, res) => {
    try {
        const { id, company_id, date_received, notes, items, created_by } = req.body;

        if (!id || !company_id || !date_received || !items || items.length === 0) {
            return res.status(400).json({ error: 'PO ID, Company, Date Received, and Line Items are required.' });
        }

        const db = await getDbConnection();

        // Validate company exists and has a tier
        const company = await db.get("SELECT tier FROM companies WHERE id = ?", [company_id]);
        if (!company) {
            await db.close();
            return res.status(400).json({ error: 'Company does not exist in master.' });
        }
        if (!company.tier) {
            await db.close();
            return res.status(400).json({ error: 'Company must have a tier assigned before creating purchase orders.' });
        }

        await db.run('BEGIN TRANSACTION');

        await db.run(
            `INSERT INTO purchase_orders (id, company_id, date_received, status, notes, created_by)
             VALUES (?, ?, ?, 'Received', ?, ?)`,
            [id, company_id, date_received, notes || '', created_by || 'System']
        );

        for (const item of items) {
            if (isNaN(item.quantity) || parseFloat(item.quantity) <= 0) {
                throw new Error('Quantity must be a positive number.');
            }
            await db.run(
                `INSERT INTO po_line_items (po_id, product_type, quantity, allocated_quantity)
                 VALUES (?, ?, ?, 0)`,
                [id, item.product_type, parseFloat(item.quantity)]
            );
        }

        await db.run('COMMIT');
        await db.close();
        res.json({ success: true, message: 'Purchase Order created successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. Dispatch Planning & AI Optimizer Endpoints
// ==========================================
app.get('/api/optimizer', async (req, res) => {
    try {
        const db = await getDbConnection();
        const systemDate = await getSystemDate(db);
        
        // 1. Get stock levels as of today
        const stockRows = await db.all("SELECT product_type, closing_stock FROM inventory_snapshots WHERE date = ?", [systemDate]);
        const currentStocks = {};
        // Default to 0 for products with missing snapshots
        ['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene'].forEach(p => {
            currentStocks[p] = 0.0;
        });
        stockRows.forEach(r => {
            currentStocks[r.product_type] = r.closing_stock;
        });

        // 2. Fetch all PO line items in Received or Partially Allocated status
        const pendingItems = await db.all(
            `SELECT li.*, po.date_received, c.id as company_id, c.name as company_name, c.tier as company_tier, c.credit_status
             FROM po_line_items li
             JOIN purchase_orders po ON li.po_id = po.id
             JOIN companies c ON po.company_id = c.id
             WHERE po.status IN ('Received', 'Partially Allocated') AND (li.quantity - li.allocated_quantity) > 0`
        );

        // 3. Run scoring algorithm
        const scoredItems = [];
        const productPendingSums = {}; // track cumulative allocation needs during optimization
        
        // Sorting items to simulate stock risk correctly
        // Deterministic Scorer:
        // Tier A = 100, Tier B = 60, Tier C = 20
        // Age: +2 points per day since received, capped at 40
        // Stock penalty: if available stock < pending qty, apply -30
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
            
            const score = basePoints + agePoints + stockPenalty;
            
            scoredItems.push({
                ...item,
                pending_quantity: pendingQty,
                order_age_days: ageDays,
                base_points: basePoints,
                age_points: agePoints,
                stock_penalty: stockPenalty,
                score: score,
                available_stock: availableStock
            });
        }

        // Sort items by final score DESC
        scoredItems.sort((a, b) => b.score - a.score);

        // 4. Generate Recommendations (Vehicle Consolidation)
        // Default capacity: 32 MT
        const capRow = await db.get("SELECT value FROM system_settings WHERE key = 'vehicle_capacity_mt'");
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
                // If company is On Hold, show warning but do not allocate automatically unless planner overrides (dealt with in UI)
                // In optimization logic, skip companies on hold to prevent illegal auto-allocations
                if (item.credit_status === 'On Hold') {
                    continue;
                }

                let qtyToAllocate = Math.min(item.pending_quantity, remainingStocks[prod]);
                if (qtyToAllocate <= 0) continue;

                // Split allocation if it exceeds vehicle capacity
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
                        // Ship vehicle run
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

            // Ship partial run if any items left
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

        await db.close();
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
        // override_logs: Array of { company_id, po_id, reason } for any credit hold overrides
        
        if (!runs || runs.length === 0) {
            return res.status(400).json({ error: 'No vehicle runs supplied.' });
        }

        const db = await getDbConnection();
        const systemDate = await getSystemDate(db);

        await db.run('BEGIN TRANSACTION');

        const timestamp = new Date().toISOString();

        for (const run of runs) {
            const dispatchId = `DSP-${run.run_id}-${Date.now().toString().slice(-4)}`;
            
            // Create dispatch log in Planned status
            await db.run(
                `INSERT INTO dispatch_log (id, product_type, quantity, vehicle_id, planned_dispatch_date, status, created_by)
                 VALUES (?, ?, ?, ?, ?, 'Planned', ?)`,
                [dispatchId, run.product_type, run.total_quantity, run.run_id, systemDate, created_by || 'System']
            );

            for (const alloc of run.allocations) {
                // Verify if credit hold override is logged if company is On Hold
                const comp = await db.get("SELECT credit_status FROM companies WHERE id = ?", [alloc.company_id]);
                if (comp && comp.credit_status === 'On Hold') {
                    const override = override_logs?.find(o => o.po_id === alloc.po_id);
                    if (!override) {
                        throw new Error(`Credit hold override reason required for company: ${alloc.company_name} (PO: ${alloc.po_id})`);
                    }
                    console.log(`Credit Hold Override Logged: PO ${alloc.po_id} - Reason: ${override.reason}`);
                }

                // Add allocation detail
                await db.run(
                    `INSERT INTO dispatch_allocations (dispatch_id, po_id, po_line_item_id, quantity)
                     VALUES (?, ?, ?, ?)`,
                    [dispatchId, alloc.po_id, alloc.po_line_item_id, alloc.quantity]
                );

                // Update PO line item allocated_quantity
                await db.run(
                    `UPDATE po_line_items 
                     SET allocated_quantity = allocated_quantity + ?, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [alloc.quantity, alloc.po_line_item_id]
                );

                // Recalculate and update the main PO status
                const poItems = await db.all("SELECT quantity, allocated_quantity FROM po_line_items WHERE po_id = ?", [alloc.po_id]);
                const totalOrdered = poItems.reduce((s, c) => s + c.quantity, 0);
                const totalAllocated = poItems.reduce((s, c) => s + c.allocated_quantity, 0);

                let newStatus = 'Received';
                if (totalAllocated >= totalOrdered) {
                    newStatus = 'Fully Allocated';
                } else if (totalAllocated > 0) {
                    newStatus = 'Partially Allocated';
                }

                await db.run(
                    `UPDATE purchase_orders 
                     SET status = ?, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [newStatus, alloc.po_id]
                );
            }
        }

        await db.run('COMMIT');
        await db.close();
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
        
        const db = await getDbConnection();
        const dispatch = await db.get("SELECT * FROM dispatch_log WHERE id = ?", [id]);
        if (!dispatch) {
            await db.close();
            return res.status(404).json({ error: 'Dispatch record not found.' });
        }

        // Immutable checks
        if (dispatch.status === 'Executed') {
            // Once Executed, it can only be Cancelled (requires reason)
            if (status !== 'Cancelled') {
                await db.close();
                return res.status(400).json({ error: 'Executed dispatches are immutable and can only be Cancelled.' });
            }
            if (!cancellation_reason) {
                await db.close();
                return res.status(400).json({ error: 'Cancellation reason is required to cancel an executed dispatch.' });
            }
        }

        await db.run('BEGIN TRANSACTION');

        const finalStatus = status; // Planned, Executed, Cancelled
        const actualDate = status === 'Executed' ? (actual_dispatch_date || dispatch.planned_dispatch_date) : null;

        await db.run(
            `UPDATE dispatch_log 
             SET status = ?, cancellation_reason = ?, actual_dispatch_date = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [finalStatus, cancellation_reason || null, actualDate, id]
        );

        // If executed, we must deduct from inventory snapshot for today
        if (finalStatus === 'Executed' && dispatch.status !== 'Executed') {
            const systemDate = actualDate;
            const snapshotId = `${dispatch.product_type}_${systemDate}`;

            // Check if snapshot exists for this product + date
            const snapshot = await db.get("SELECT * FROM inventory_snapshots WHERE id = ?", [snapshotId]);
            if (snapshot) {
                // Update snapshot dispatched_out and closing_stock
                const newDispatched = snapshot.dispatched_out + dispatch.quantity;
                const newClosing = Math.max(0, snapshot.opening_stock + snapshot.production_added + snapshot.purchased_material_received - newDispatched);
                await db.run(
                    `UPDATE inventory_snapshots 
                     SET dispatched_out = ?, closing_stock = ?, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [newDispatched, newClosing, snapshotId]
                );
            } else {
                // Create snapshot
                // Find yesterday's closing stock as opening stock
                const yesterday = new Date(systemDate);
                yesterday.setDate(yesterday.getDate() - 1);
                const yestStr = yesterday.toISOString().split('T')[0];
                const yestSnap = await db.get("SELECT closing_stock FROM inventory_snapshots WHERE product_type = ? AND date = ?", [dispatch.product_type, yestStr]);
                const openStock = yestSnap ? yestSnap.closing_stock : 0.0;
                const closeStock = Math.max(0, openStock - dispatch.quantity);

                await db.run(
                    `INSERT INTO inventory_snapshots (id, product_type, date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed)
                     VALUES (?, ?, ?, ?, 0, 0, ?, ?, 0)`,
                    [snapshotId, dispatch.product_type, systemDate, openStock, dispatch.quantity, closeStock]
                );
            }

            // Update associated POs status to 'Dispatched' or 'Closed' if fully shipped
            const allocations = await db.all("SELECT * FROM dispatch_allocations WHERE dispatch_id = ?", [id]);
            for (const alloc of allocations) {
                // If PO was fully allocated and now dispatched, set status to Dispatched
                const poItems = await db.all("SELECT SUM(quantity) as tot_qty, SUM(allocated_quantity) as tot_alloc FROM po_line_items WHERE po_id = ?", [alloc.po_id]);
                const totalQty = poItems[0].tot_qty;
                const totalAlloc = poItems[0].tot_alloc;

                if (totalAlloc >= totalQty) {
                    await db.run("UPDATE purchase_orders SET status = 'Dispatched', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [alloc.po_id]);
                }
            }
        }

        // If cancelled, we must restore PO allocations
        if (finalStatus === 'Cancelled') {
            const allocations = await db.all("SELECT * FROM dispatch_allocations WHERE dispatch_id = ?", [id]);
            for (const alloc of allocations) {
                await db.run(
                    `UPDATE po_line_items 
                     SET allocated_quantity = MAX(0, allocated_quantity - ?), updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [alloc.quantity, alloc.po_line_item_id]
                );

                // Recalculate PO status
                const poItems = await db.all("SELECT quantity, allocated_quantity FROM po_line_items WHERE po_id = ?", [alloc.po_id]);
                const totalOrdered = poItems.reduce((s, c) => s + c.quantity, 0);
                const totalAllocated = poItems.reduce((s, c) => s + c.allocated_quantity, 0);

                let newStatus = 'Received';
                if (totalAllocated >= totalOrdered && totalOrdered > 0) {
                    newStatus = 'Fully Allocated';
                } else if (totalAllocated > 0) {
                    newStatus = 'Partially Allocated';
                }

                await db.run(
                    `UPDATE purchase_orders 
                     SET status = ?, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [newStatus, alloc.po_id]
                );
            }

            // Deduct dispatched_out from snapshot if it was Executed before
            if (dispatch.status === 'Executed') {
                const systemDate = dispatch.actual_dispatch_date || dispatch.planned_dispatch_date;
                const snapshotId = `${dispatch.product_type}_${systemDate}`;
                const snapshot = await db.get("SELECT * FROM inventory_snapshots WHERE id = ?", [snapshotId]);
                if (snapshot) {
                    const newDispatched = Math.max(0, snapshot.dispatched_out - dispatch.quantity);
                    const newClosing = Math.max(0, snapshot.opening_stock + snapshot.production_added + snapshot.purchased_material_received - newDispatched);
                    await db.run(
                        `UPDATE inventory_snapshots 
                         SET dispatched_out = ?, closing_stock = ?, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = ?`,
                        [newDispatched, newClosing, snapshotId]
                    );
                }
            }
        }

        await db.run('COMMIT');
        await db.close();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dispatch', async (req, res) => {
    try {
        const db = await getDbConnection();
        const rows = await db.all("SELECT * FROM dispatch_log ORDER BY planned_dispatch_date DESC, id DESC");
        
        // Attach allocations
        for (const row of rows) {
            const allocs = await db.all(
                `SELECT da.*, po.company_id, c.name as company_name 
                 FROM dispatch_allocations da
                 JOIN purchase_orders po ON da.po_id = po.id
                 JOIN companies c ON po.company_id = c.id
                 WHERE da.dispatch_id = ?`,
                [row.id]
            );
            row.allocations = allocs;
        }

        await db.close();
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
        const db = await getDbConnection();
        const systemDate = await getSystemDate(db);
        const thresholds = await getInventoryThresholds(db);

        // Fetch snapshots (last 45 days)
        const snapshots = await db.all(
            `SELECT * FROM inventory_snapshots 
             WHERE date <= ? 
             ORDER BY date DESC, product_type ASC 
             LIMIT 270` // 6 products * 45 days = 270 rows
        );

        // Calculate reconciliation alerts for each snapshot
        const result = [];
        for (const snap of snapshots) {
            // Get sum of executed dispatches for this product and date
            const sumRow = await db.get(
                `SELECT SUM(quantity) as total_qty 
                 FROM dispatch_log 
                 WHERE product_type = ? AND status = 'Executed' AND actual_dispatch_date = ?`,
                [snap.product_type, snap.date]
            );
            const actualDispatched = sumRow && sumRow.total_qty ? parseFloat(sumRow.total_qty) : 0.0;
            
            // Reconciliation check: manual dispatched_out vs executed dispatch records
            const delta = Math.abs(snap.dispatched_out - actualDispatched);
            const hasMismatch = delta > 0.01;

            // Health status
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

        await db.close();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/inventory/confirm', async (req, res) => {
    try {
        const { date, product_types, created_by } = req.body;
        // Confirms snapshot for specified products on selected date
        
        if (!date || !product_types || product_types.length === 0) {
            return res.status(400).json({ error: 'Date and product types are required.' });
        }

        const db = await getDbConnection();
        await db.run('BEGIN TRANSACTION');

        for (const prod of product_types) {
            const snapshotId = `${prod}_${date}`;
            
            // Fetch current snapshot to perform closing stock math verification
            const snap = await db.get("SELECT * FROM inventory_snapshots WHERE id = ?", [snapshotId]);
            if (!snap) {
                throw new Error(`Inventory snapshot for ${prod} on date ${date} does not exist. Create it first.`);
            }

            // Verify math closing = opening + added + received - dispatched
            const calculatedClosing = Math.max(0, snap.opening_stock + snap.production_added + snap.purchased_material_received - snap.dispatched_out);
            
            await db.run(
                `UPDATE inventory_snapshots 
                 SET confirmed = 1, closing_stock = ?, updated_at = CURRENT_TIMESTAMP, created_by = ? 
                 WHERE id = ?`,
                [calculatedClosing, created_by || 'System', snapshotId]
            );

            // Update next day's opening stock if next day snapshot exists!
            const nextDay = new Date(date);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayStr = nextDay.toISOString().split('T')[0];
            const nextDaySnapId = `${prod}_${nextDayStr}`;

            const nextSnap = await db.get("SELECT * FROM inventory_snapshots WHERE id = ?", [nextDaySnapId]);
            if (nextSnap) {
                const nextClosing = Math.max(0, calculatedClosing + nextSnap.production_added + nextSnap.purchased_material_received - nextSnap.dispatched_out);
                await db.run(
                    `UPDATE inventory_snapshots 
                     SET opening_stock = ?, closing_stock = ? 
                     WHERE id = ?`,
                    [calculatedClosing, nextClosing, nextDaySnapId]
                );
            }
        }

        await db.run('COMMIT');
        await db.close();
        res.json({ success: true, message: `Day ${date} inventory snapshots locked successfully.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/inventory/:id', async (req, res) => {
    // Allows updating/inserting manual snapshot
    try {
        const { id } = req.params; // e.g. Acetone_2026-06-29
        const { opening_stock, production_added, purchased_material_received, dispatched_out, confirmed } = req.body;
        
        const [prod, date] = id.split('_');
        const db = await getDbConnection();
        
        const existing = await db.get("SELECT * FROM inventory_snapshots WHERE id = ?", [id]);
        
        const opStock = parseFloat(opening_stock);
        const prodAdd = parseFloat(production_added || 0);
        const purRec = parseFloat(purchased_material_received || 0);
        const dispOut = parseFloat(dispatched_out || 0);
        const clStock = Math.max(0, opStock + prodAdd + purRec - dispOut);

        if (existing && existing.confirmed === 1) {
            await db.close();
            return res.status(400).json({ error: 'Confirmed snapshots are locked and cannot be edited.' });
        }

        await db.run(
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

        // Cascade next day opening stock if exists
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = nextDay.toISOString().split('T')[0];
        const nextDaySnapId = `${prod}_${nextDayStr}`;
        const nextSnap = await db.get("SELECT * FROM inventory_snapshots WHERE id = ?", [nextDaySnapId]);
        if (nextSnap) {
            const nextClosing = Math.max(0, clStock + nextSnap.production_added + nextSnap.purchased_material_received - nextSnap.dispatched_out);
            await db.run(
                `UPDATE inventory_snapshots SET opening_stock = ?, closing_stock = ? WHERE id = ?`,
                [clStock, nextClosing, nextDaySnapId]
            );
        }

        await db.close();
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
        const db = await getDbConnection();
        const rows = await db.all("SELECT * FROM production_plans ORDER BY week_start_date DESC, product_type ASC");
        await db.close();
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

        const db = await getDbConnection();
        await db.run(
            `INSERT INTO production_plans (product_type, week_start_date, planned_quantity, actual_quantity, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(product_type, week_start_date) DO UPDATE SET
                planned_quantity = excluded.planned_quantity,
                actual_quantity = excluded.actual_quantity,
                updated_at = CURRENT_TIMESTAMP`,
            [product_type, week_start_date, parseFloat(planned_quantity || 0), parseFloat(actual_quantity || 0)]
        );
        await db.close();
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
        const db = await getDbConnection();
        const systemDate = await getSystemDate(db);
        const thresholds = await getInventoryThresholds(db);

        // 1. Unconfirmed snapshots banner flag
        const unconfirmedCount = await getUnconfirmedSnapshotsCount(db, systemDate);

        // 2. POs count by tier
        const poTiers = await db.all(
            `SELECT c.tier, COUNT(po.id) as count 
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             WHERE po.status IN ('Received', 'Partially Allocated')
             GROUP BY c.tier`
        );
        const tierCounts = { A: 0, B: 0, C: 0 };
        poTiers.forEach(pt => {
            tierCounts[pt.tier] = pt.count;
        });

        // 3. Current stock levels
        const stockRows = await db.all("SELECT product_type, closing_stock FROM inventory_snapshots WHERE date = ?", [systemDate]);
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
        const pos = await db.all(
            `SELECT po.*, c.name as company_name 
             FROM purchase_orders po 
             JOIN companies c ON po.company_id = c.id
             WHERE po.status IN ('Received', 'Partially Allocated')`
        );
        const anomalousPOs = [];
        for (const po of pos) {
            const items = await db.all("SELECT * FROM po_line_items WHERE po_id = ?", [po.id]);
            let isPoAnomalous = false;
            for (const item of items) {
                const avg90 = await getCompany90DayAverage(db, po.company_id, item.product_type, systemDate);
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
        // Formula: Projected(t) = Projected(t-1) + DailyProduction - DailyDispatches
        const shortageAlerts = [];
        const forwardProjections = {};

        for (const prod of products) {
            const minT = thresholds[prod] || 0.0;
            const startStock = currentStocks[prod] !== undefined ? currentStocks[prod] : 100.0;
            const projList = [{ day: 0, date: systemDate, stock: startStock }];

            // Get historical production ratio to adjust AI forecast if underperforming
            const prodRatio = await getProductionPerformanceRatio(db, prod, systemDate);

            // Fetch weekly plan containing systemDate
            const planRow = await db.get(
                `SELECT planned_quantity FROM production_plans 
                 WHERE product_type = ? AND week_start_date <= ? 
                 ORDER BY week_start_date DESC LIMIT 1`,
                [prod, systemDate]
            );
            const weeklyPlanned = planRow ? planRow.planned_quantity : 50.0;
            // daily production base = planned weekly / 7, scaled down by performance ratio if active
            const dailyProduction = (weeklyPlanned / 7.0) * (prodRatio < 1.0 ? prodRatio : 1.0);

            // Get pending allocations/POs per day for next 7 days
            // We look at planned dispatches in the system
            const plannedDispatches = await db.all(
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

            // Also grab all received/partially allocated PO lines that are NOT yet scheduled in dispatch logs
            // They represent pending demand that will be fulfilled in the coming days. Let's spread them out
            // or assume they hit on day 1 to be safe (conservative supply chain projection).
            const unscheduledRow = await db.get(
                `SELECT SUM(li.quantity - li.allocated_quantity) as unscheduled_qty
                 FROM po_line_items li
                 JOIN purchase_orders po ON li.po_id = po.id
                 WHERE li.product_type = ? AND po.status IN ('Received', 'Partially Allocated')`,
                [prod]
            );
            const unscheduledQty = unscheduledRow && unscheduledRow.unscheduled_qty ? unscheduledRow.unscheduled_qty : 0;

            let prevStock = startStock;
            let flaggedShortage = false;

            for (let t = 1; t <= 7; t++) {
                const pDate = new Date(systemDate);
                pDate.setDate(pDate.getDate() + t);
                const pDateStr = pDate.toISOString().split('T')[0];

                const dispatchQty = plannedDispMap[pDateStr] || 0.0;
                
                // Incorporate unscheduled PO demand on Day 2/3/4 as an expectation
                // To keep it simple: we distribute unscheduled PO quantities across days 2, 3, 4
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

        await db.close();
        res.json({
            system_date: systemDate,
            unconfirmed_snapshots_count: unconfirmedCount,
            open_po_tier_counts: tierCounts,
            inventory_statuses: stockStatuses,
            anomalous_pos: anomalousPOs,
            shortage_alerts: shortageAlerts,
            forward_projections: forwardProjections
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 8. Reports Endpoints
// ==========================================
app.get('/api/reports', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'Start Date and End Date parameters are required.' });
        }

        const db = await getDbConnection();

        // REPORT A: Monthly Dispatch Summary
        // total dispatched per company per product per month
        const monthlySummary = await db.all(
            `SELECT 
                c.name as company_name, 
                dl.product_type,
                strftime('%Y-%m', dl.actual_dispatch_date) as month,
                SUM(dl.quantity) as total_dispatched_qty,
                (SELECT SUM(li.quantity - li.allocated_quantity)
                 FROM po_line_items li 
                 JOIN purchase_orders po ON li.po_id = po.id
                 WHERE po.company_id = c.id AND li.product_type = dl.product_type AND po.status IN ('Received', 'Partially Allocated')) as pending_balance
             FROM dispatch_log dl
             JOIN dispatch_allocations da ON dl.id = da.dispatch_id
             JOIN purchase_orders po ON da.po_id = po.id
             JOIN companies c ON po.company_id = c.id
             WHERE dl.status = 'Executed' AND dl.actual_dispatch_date BETWEEN ? AND ?
             GROUP BY c.id, dl.product_type, month
             ORDER BY month DESC, c.name ASC`,
            [start_date, end_date]
        );

        // REPORT B: Inventory Movement Report
        // daily opening/closing per product
        const inventoryMovement = await db.all(
            `SELECT product_type, date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed
             FROM inventory_snapshots
             WHERE date BETWEEN ? AND ?
             ORDER BY date DESC, product_type ASC`,
            [start_date, end_date]
        );

        // REPORT C: PO Fulfillment Rate
        // % of PO quantity fulfilled within 7/14/30 days by tier
        // Compare po.date_received vs dl.actual_dispatch_date
        const fulfillmentRows = await db.all(
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

        // Analyze fulfillment windows (7, 14, 30 days) grouped by tier
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
        // Comparison of AI-recommended dispatch quantities vs actual planner dispatched
        // We look at each day. We compare the AI priority scoring list allocations vs actual dispatches executed.
        // For simplicity, we can fetch all dispatches in Executed status and see if they were generated
        // via optimizer runs (their ID starts with DSP-RUN- or they are linked to runs).
        // Let's compare daily total recommended optimization vs daily total executed
        const aiVsActual = await db.all(
            `SELECT 
                date,
                product_type,
                SUM(rec_qty) as ai_recommended_qty,
                SUM(act_qty) as actual_dispatched_qty
             FROM (
                -- Subquery 1: AI Recommended quantities (Planned dispatches derived from RUNS)
                SELECT 
                    planned_dispatch_date as date, 
                    product_type, 
                    SUM(quantity) as rec_qty,
                    0 as act_qty
                FROM dispatch_log
                WHERE vehicle_id LIKE 'RUN-%'
                GROUP BY date, product_type
                
                UNION ALL
                
                -- Subquery 2: Actual Executed quantities
                SELECT 
                    actual_dispatch_date as date, 
                    product_type, 
                    0 as rec_qty,
                    SUM(quantity) as act_qty
                FROM dispatch_log
                WHERE status = 'Executed' AND actual_dispatch_date IS NOT NULL
                GROUP BY date, product_type
             )
             WHERE date BETWEEN ? AND ?
             GROUP BY date, product_type
             ORDER BY date DESC, product_type ASC`,
            [start_date, end_date]
        );

        await db.close();
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

        const db = await getDbConnection();
        const systemDate = await getSystemDate(db);
        const thresholds = await getInventoryThresholds(db);
        
        // Retrieve key if any
        const keyRow = await db.get("SELECT value FROM system_settings WHERE key = 'anthropic_api_key'");
        const apiKey = keyRow ? keyRow.value : process.env.ANTHROPIC_API_KEY;

        // Fetch current context from database
        const stockRows = await db.all("SELECT product_type, closing_stock FROM inventory_snapshots WHERE date = ?", [systemDate]);
        const currentStocks = {};
        stockRows.forEach(r => {
            currentStocks[r.product_type] = r.closing_stock;
        });

        const pendingPOs = await db.all(
            `SELECT po.id, c.name as company, c.tier, li.product_type, (li.quantity - li.allocated_quantity) as pending_qty, po.date_received
             FROM purchase_orders po
             JOIN companies c ON po.company_id = c.id
             JOIN po_line_items li ON po.id = li.po_id
             WHERE po.status IN ('Received', 'Partially Allocated') AND pending_qty > 0`
        );

        const productionPlans = await db.all(
            `SELECT * FROM production_plans WHERE week_start_date >= ? ORDER BY week_start_date ASC LIMIT 12`,
            [systemDate]
        );

        await db.close();

        // System prompt context injection
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

        // If Anthropic API key is provided, execute actual call. Otherwise, fall back to smart local solver.
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
            // Simulated intelligent responder
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
    
    // Question 1: "Which customer orders should be dispatched today?"
    if (msg.includes('dispatch') && (msg.includes('today') || msg.includes('which customer') || msg.includes('order'))) {
        const activeList = pendingPOs.map(po => {
            // Calculate deterministic score
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

    // Question 2: "How much Acetone inventory will remain after fulfilling all Tier A POs?"
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

    // Question 3: "Will we have enough Benzene for Punjab Chemicals' order by next Thursday?"
    if (msg.includes('benzene') && msg.includes('punjab') && msg.includes('thursday')) {
        const punjabBenzene = pendingPOs
            .filter(po => po.company.includes('Punjab') && po.product_type === 'Benzene')
            .reduce((acc, curr) => acc + curr.pending_qty, 0);

        const currentStock = stocks['Benzene'] || 0.0;
        // Let's say next Thursday is 7 days out, so we project stock using production plan
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

    // Question 4: "Which POs are at risk of stockout this week?"
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

    // Default response
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
