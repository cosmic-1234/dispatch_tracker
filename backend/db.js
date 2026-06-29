import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'dispatch.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

export async function getDbConnection() {
    return open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });
}

export async function initDb() {
    const db = await getDbConnection();
    
    // Enable foreign keys
    await db.run('PRAGMA foreign_keys = ON');

    // Read and run schema.sql
    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    // SQLite run() can only execute one statement at a time in some wrappers, so we split by semicolon
    // But since schemaSql contains statements, we split carefully
    const statements = schemaSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    for (const statement of statements) {
        await db.run(statement);
    }

    // Check if seeded
    const row = await db.get('SELECT COUNT(*) as count FROM companies');
    if (row.count === 0) {
        console.log('Seeding database with realistic chemical solvent enterprise data...');
        await seedDatabase(db);
    } else {
        console.log('Database already initialized.');
    }
    
    await db.close();
}

async function seedDatabase(db) {
    // 1. Seed Company Master
    const companies = [
        { id: 'COMP-001', name: 'Punjab Chemicals Ltd', tier: 'A', primary_products: JSON.stringify(['Acetone', 'Benzene']), contact_person: 'Harpreet Singh', contact_phone: '+91-98765-43210', credit_status: 'Active' },
        { id: 'COMP-002', name: 'Rajasthan Organics Corp', tier: 'B', primary_products: JSON.stringify(['DEP', 'Ethyl Acetate']), contact_person: 'Rajendra Prasad', contact_phone: '+91-87654-32109', credit_status: 'Active' },
        { id: 'COMP-003', name: 'Gujarat Industrial Paints', tier: 'A', primary_products: JSON.stringify(['Retarder', 'Toluene']), contact_person: 'Amit Shah', contact_phone: '+91-76543-21098', credit_status: 'Active' },
        { id: 'COMP-004', name: 'Deccan Solvent Distributors', tier: 'C', primary_products: JSON.stringify(['Acetone', 'Toluene']), contact_person: 'Venkat Rao', contact_phone: '+91-65432-10987', credit_status: 'Active' },
        { id: 'COMP-005', name: 'Alpha Pharmaceuticals Inc', tier: 'B', primary_products: JSON.stringify(['Benzene', 'DEP']), contact_person: 'Srinivas Murthy', contact_phone: '+91-54321-09876', credit_status: 'On Hold' },
        { id: 'COMP-006', name: 'Apex Logistics & Solvents', tier: 'C', primary_products: JSON.stringify(['Ethyl Acetate', 'Retarder']), contact_person: 'Vikram Malhotra', contact_phone: '+91-43210-98765', credit_status: 'Active' }
    ];

    for (const c of companies) {
        await db.run(
            `INSERT INTO companies (id, name, tier, primary_products, contact_person, contact_phone, credit_status, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-30 days'), datetime('now', '-30 days'), 'System')`,
            [c.id, c.name, c.tier, c.primary_products, c.contact_person, c.contact_phone, c.credit_status]
        );
    }

    // 2. Seed historical POs to establish 90-day averages (needed for anomaly detection)
    // Deccan Solvents averages ~12 MT per order for Acetone
    const historicalPOs = [
        { id: 'PO-HIST-001', company_id: 'COMP-004', date_received: '2026-04-10', status: 'Closed', product: 'Acetone', quantity: 10.0, allocated: 10.0 },
        { id: 'PO-HIST-002', company_id: 'COMP-004', date_received: '2026-05-15', status: 'Closed', product: 'Acetone', quantity: 12.0, allocated: 12.0 },
        { id: 'PO-HIST-003', company_id: 'COMP-001', date_received: '2026-05-01', status: 'Closed', product: 'Acetone', quantity: 30.0, allocated: 30.0 },
        { id: 'PO-HIST-004', company_id: 'COMP-001', date_received: '2026-05-20', status: 'Closed', product: 'Benzene', quantity: 25.0, allocated: 25.0 },
        { id: 'PO-HIST-005', company_id: 'COMP-003', date_received: '2026-05-10', status: 'Closed', product: 'Toluene', quantity: 40.0, allocated: 40.0 },
        { id: 'PO-HIST-006', company_id: 'COMP-002', date_received: '2026-05-25', status: 'Closed', product: 'DEP', quantity: 15.0, allocated: 15.0 }
    ];

    for (const po of historicalPOs) {
        await db.run(
            `INSERT INTO purchase_orders (id, company_id, date_received, status, notes, created_at, updated_at, created_by)
             VALUES (?, ?, ?, 'Closed', 'Historical order seeded for averages', ?, ?, 'System')`,
            [po.id, po.company_id, po.date_received, po.date_received + ' 10:00:00', po.date_received + ' 17:00:00']
        );
        await db.run(
            `INSERT INTO po_line_items (po_id, product_type, quantity, allocated_quantity, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [po.id, po.product, po.quantity, po.allocated, po.date_received + ' 10:00:00', po.date_received + ' 17:00:00']
        );
        // Also insert corresponding executed dispatches for historical POs
        const dspId = 'DSP-HIST-' + po.id.split('-')[2];
        await db.run(
            `INSERT INTO dispatch_log (id, product_type, quantity, vehicle_id, planned_dispatch_date, actual_dispatch_date, status, created_at, updated_at)
             VALUES (?, ?, ?, 'VEH-HIST-01', ?, ?, 'Executed', ?, ?)`,
            [dspId, po.product, po.quantity, po.date_received, po.date_received, po.date_received + ' 10:00:00', po.date_received + ' 17:00:00']
        );
        await db.run(
            `INSERT INTO dispatch_allocations (dispatch_id, po_id, po_line_item_id, quantity)
             VALUES (?, ?, (SELECT id FROM po_line_items WHERE po_id = ? LIMIT 1), ?)`,
            [dspId, po.id, po.id, po.quantity]
        );
    }

    // 3. Seed active pending Purchase Orders
    const activePOs = [
        // PO-2026-001: Punjab Chemicals (Tier A) - Acetone 40 MT, Benzene 20 MT. Age: 4 days (Received 2026-06-25)
        { id: 'PO-2026-001', company_id: 'COMP-001', date_received: '2026-06-25', status: 'Received', notes: 'Urgent requirement for pharma batch synthesis.', items: [{ product: 'Acetone', qty: 40.0 }, { product: 'Benzene', qty: 20.0 }] },
        // PO-2026-002: Gujarat Industrial Paints (Tier A) - Toluene 30 MT, Retarder 15 MT. Age: 1 day (Received 2026-06-28)
        { id: 'PO-2026-002', company_id: 'COMP-003', date_received: '2026-06-28', status: 'Received', notes: 'Requesting fast-track delivery. Special Retarder blend.', items: [{ product: 'Toluene', qty: 30.0 }, { product: 'Retarder', qty: 15.0 }] },
        // PO-2026-003: Rajasthan Organics (Tier B) - DEP 25 MT. Age: 9 days (Received 2026-06-20)
        { id: 'PO-2026-003', company_id: 'COMP-002', date_received: '2026-06-20', status: 'Partially Allocated', notes: 'Deliver to Udaipur plant.', items: [{ product: 'DEP', qty: 25.0, allocated: 10.0 }] },
        // PO-2026-004: Deccan Solvent Distributors (Tier C) - Acetone 50 MT. Age: 14 days (Received 2026-06-15)
        // Note: This PO is anomalous! 50 MT is > 2x Deccan's average Acetone PO of 11 MT.
        { id: 'PO-2026-004', company_id: 'COMP-004', date_received: '2026-06-15', status: 'Received', notes: 'Bulk purchase order for festival inventory.', items: [{ product: 'Acetone', qty: 50.0 }] },
        // PO-2026-005: Alpha Pharmaceuticals (Tier B) - Benzene 15 MT. Age: 2 days (Received 2026-06-27). Company is On Hold.
        { id: 'PO-2026-005', company_id: 'COMP-005', date_received: '2026-06-27', status: 'Received', notes: 'Credit verification pending but order accepted.', items: [{ product: 'Benzene', qty: 15.0 }] }
    ];

    for (const po of activePOs) {
        await db.run(
            `INSERT INTO purchase_orders (id, company_id, date_received, status, notes, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, ?, datetime(?, '+10 hours'), datetime(?, '+10 hours'), 'System')`,
            [po.id, po.company_id, po.date_received, po.status, po.notes, po.date_received, po.date_received]
        );
        for (const item of po.items) {
            await db.run(
                `INSERT INTO po_line_items (po_id, product_type, quantity, allocated_quantity, created_at, updated_at)
                 VALUES (?, ?, ?, ?, datetime(?, '+10 hours'), datetime(?, '+10 hours'))`,
                [po.id, item.product, item.qty, item.allocated || 0, po.date_received, po.date_received]
            );
        }
    }

    // Insert an active planned dispatch for PO-2026-003 to show Partially Allocated state
    await db.run(
        `INSERT INTO dispatch_log (id, product_type, quantity, vehicle_id, planned_dispatch_date, status, created_at, updated_at)
         VALUES ('DSP-2026-003-PARTIAL', 'DEP', 10.0, 'VEH-PLN-99', '2026-06-28', 'Planned', datetime('now', '-1 day'), datetime('now', '-1 day'))`
    );
    await db.run(
        `INSERT INTO dispatch_allocations (dispatch_id, po_id, po_line_item_id, quantity)
         VALUES ('DSP-2026-003-PARTIAL', 'PO-2026-003', (SELECT id FROM po_line_items WHERE po_id = 'PO-2026-003' LIMIT 1), 10.0)`
    );

    // 4. Seed Inventory Snapshots for the last 30 days
    // Products: Acetone, Benzene, DEP, Ethyl Acetate, Retarder, Toluene
    const products = ['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene'];
    const initialStocks = {
        Acetone: 150.0,
        Benzene: 100.0,
        DEP: 40.0,
        'Ethyl Acetate': 120.0,
        Retarder: 25.0,
        Toluene: 180.0
    };

    // Safety thresholds configuration
    const thresholds = {
        Acetone: 50.0,
        Benzene: 40.0,
        DEP: 20.0,
        'Ethyl Acetate': 30.0,
        Retarder: 10.0,
        Toluene: 60.0
    };

    // We will simulate 30 days from 2026-05-30 to 2026-06-29.
    // Date loop
    const systemDate = new Date('2026-06-29');
    let currentStocks = { ...initialStocks };

    for (let d = 30; d >= 0; d--) {
        const currentDate = new Date(systemDate);
        currentDate.setDate(systemDate.getDate() - d);
        const dateStr = currentDate.toISOString().split('T')[0];

        // Seed snapshot per product
        for (const prod of products) {
            const openStock = currentStocks[prod];
            
            // Random daily activity
            let prodAdded = 0.0;
            // Let's say production added every Tuesday and Friday
            const dayOfWeek = currentDate.getDay(); // 0 is Sunday, 2 is Tuesday, 5 is Friday
            if (dayOfWeek === 2 || dayOfWeek === 5) {
                prodAdded = prod === 'Acetone' ? 25.0 : prod === 'Benzene' ? 15.0 : prod === 'DEP' ? 8.0 : prod === 'Ethyl Acetate' ? 20.0 : prod === 'Retarder' ? 4.0 : 30.0;
            }
            
            let purchaseRec = 0.0;
            // Purchases arrive occasionally on Thursdays
            if (dayOfWeek === 4) {
                purchaseRec = prod === 'DEP' ? 10.0 : prod === 'Retarder' ? 5.0 : 0.0;
            }

            let dispOut = 0.0;
            // Dispatches occur on weekdays (Mon-Fri)
            if (dayOfWeek >= 1 && dayOfWeek <= 5 && d > 0) {
                // If it is not today, simulate some dispatches
                dispOut = prod === 'Acetone' ? 12.0 : prod === 'Benzene' ? 8.0 : prod === 'DEP' ? 3.0 : prod === 'Ethyl Acetate' ? 10.0 : prod === 'Retarder' ? 2.0 : 15.0;
            }

            // On 2026-06-28 (yesterday), we had a dispatch of 10.0 for DEP (PO-2026-003)
            if (dateStr === '2026-06-28' && prod === 'DEP') {
                dispOut = 10.0;
            }

            // Calculate closing stock
            const closeStock = Math.max(0, openStock + prodAdded + purchaseRec - dispOut);
            currentStocks[prod] = closeStock;

            // Snapshots before today are confirmed. Today (d === 0) is unconfirmed!
            const isConfirmed = d === 0 ? 0 : 1;

            const snapshotId = `${prod}_${dateStr}`;
            await db.run(
                `INSERT INTO inventory_snapshots (id, product_type, date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-30 days'), datetime('now', '-30 days'))`,
                [snapshotId, prod, dateStr, openStock, prodAdded, purchaseRec, dispOut, closeStock, isConfirmed]
            );
        }
    }

    // 5. Seed Production Plan (week-wise)
    // Weeks: 2026-06-15, 2026-06-22, 2026-06-29
    const weeks = ['2026-06-15', '2026-06-22', '2026-06-29'];
    const plans = [
        { product: 'Acetone', planned: 50.0, actual: 48.0 },
        { product: 'Benzene', planned: 30.0, actual: 28.0 },
        { product: 'DEP', planned: 16.0, actual: 8.0 }, // DEP production has underperformed! This will trigger lower AI projections.
        { product: 'Ethyl Acetate', planned: 40.0, actual: 42.0 },
        { product: 'Retarder', planned: 8.0, actual: 8.0 },
        { product: 'Toluene', planned: 60.0, actual: 60.0 }
    ];

    for (const w of weeks) {
        for (const p of plans) {
            // For the week of 2026-06-29, actual is 0 initially
            const actualQty = w === '2026-06-29' ? 0.0 : p.actual;
            await db.run(
                `INSERT INTO production_plans (product_type, week_start_date, planned_quantity, actual_quantity, created_at, updated_at)
                 VALUES (?, ?, ?, ?, datetime('now', '-30 days'), datetime('now', '-30 days'))`,
                [p.product, w, p.planned, actualQty]
            );
        }
    }

    // 6. Seed System Settings
    const settings = [
        { key: 'min_threshold_Acetone', value: '50.0' },
        { key: 'min_threshold_Benzene', value: '40.0' },
        { key: 'min_threshold_DEP', value: '20.0' },
        { key: 'min_threshold_Ethyl Acetate', value: '30.0' },
        { key: 'min_threshold_Retarder', value: '10.0' },
        { key: 'min_threshold_Toluene', value: '60.0' },
        { key: 'vehicle_capacity_mt', value: '32.0' },
        { key: 'system_date', value: '2026-06-29' },
        { key: 'anthropic_api_key', value: '' }
    ];

    for (const s of settings) {
        await db.run(
            `INSERT INTO system_settings (key, value) VALUES (?, ?)`,
            [s.key, s.value]
        );
    }
}
