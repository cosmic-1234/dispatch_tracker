import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'dispatch.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const DATABASE_URL = process.env.DATABASE_URL;
const isPg = !!DATABASE_URL;

let pgPool = null;
let sqliteDb = null;

if (isPg) {
    console.log('PostgreSQL database URL detected. Running in PostgreSQL mode.');
    pgPool = new pg.Pool({
        connectionString: DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });
} else {
    console.log('No PostgreSQL DATABASE_URL found. Running in SQLite mode.');
}

// Convert SQLite query placeholders (?) to PG placeholders ($1, $2, ...)
export function translateSql(sql) {
    if (!isPg) return sql;
    let translated = sql;
    
    // Convert ? to $1, $2, ...
    let paramCount = 1;
    while (translated.includes('?')) {
        translated = translated.replace('?', `$${paramCount++}`);
    }
    
    // Translate SQLite strftime to PostgreSQL to_char
    translated = translated.replace(/strftime\(\s*['"]%Y-%m['"]\s*,\s*([^)]+)\)/gi, "to_char($1, 'YYYY-MM')");
    
    return translated;
}

export async function getDbConnection() {
    if (isPg) {
        return pgPool;
    } else {
        if (!sqliteDb) {
            sqliteDb = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
        }
        return sqliteDb;
    }
}

// Helper: query list of rows
export async function queryAll(sql, params = []) {
    const db = await getDbConnection();
    if (isPg) {
        const translated = translateSql(sql);
        const res = await db.query(translated, params);
        return res.rows;
    } else {
        return db.all(sql, params);
    }
}

// Helper: query single row
export async function queryGet(sql, params = []) {
    const db = await getDbConnection();
    if (isPg) {
        const translated = translateSql(sql);
        const res = await db.query(translated, params);
        return res.rows[0] || null;
    } else {
        return db.get(sql, params);
    }
}

// Helper: run statement
export async function queryRun(sql, params = []) {
    const db = await getDbConnection();
    if (isPg) {
        const translated = translateSql(sql);
        const res = await db.query(translated, params);
        return { changes: res.rowCount };
    } else {
        return db.run(sql, params);
    }
}

// Helper: Run code in a database transaction block
export async function runInTransaction(callback) {
    if (isPg) {
        const client = await pgPool.connect();
        try {
            await client.query('BEGIN');
            
            const txDb = {
                all: (sql, params = []) => client.query(translateSql(sql), params).then(res => res.rows),
                get: (sql, params = []) => client.query(translateSql(sql), params).then(res => res.rows[0] || null),
                run: (sql, params = []) => client.query(translateSql(sql), params).then(res => ({ changes: res.rowCount }))
            };
            
            const result = await callback(txDb);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } else {
        const db = await getDbConnection();
        await db.run('BEGIN TRANSACTION');
        try {
            const txDb = {
                all: (sql, params = []) => db.all(sql, params),
                get: (sql, params = []) => db.get(sql, params),
                run: (sql, params = []) => db.run(sql, params)
            };
            const result = await callback(txDb);
            await db.run('COMMIT');
            return result;
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    }
}

// Init database tables
export async function initDb() {
    if (isPg) {
        const client = await pgPool.connect();
        try {
            const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
            // Remove single line SQL comments
            const cleanSql = schemaSql.replace(/--.*$/gm, '');
            
            // Adapt schema for PostgreSQL
            let pgSchema = cleanSql
                .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
                .replace(/\bDATETIME\b/g, 'TIMESTAMP')
                .replace(/CHECK\(confirmed IN \(0, 1\)\)/g, ''); // ignore boolean check in postgres
            
            const statements = pgSchema
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            for (const statement of statements) {
                if (statement.toUpperCase().startsWith('PRAGMA')) continue;
                await client.query(statement);
            }

            // Run column migrations for PG if existing tables don't have them
            try {
                await client.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS portal_login_enabled INTEGER DEFAULT 0");
                await client.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS commitment_health_score REAL");
                await client.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS relationship_risk_flag INTEGER DEFAULT 0");
                await client.query("ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS committed_dispatch_date DATE");
                await client.query("ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS commitment_status TEXT DEFAULT 'Pending'");
            } catch (err) {
                console.warn('PostgreSQL column migration warning:', err.message);
            }

            const res = await client.query('SELECT COUNT(*) as count FROM companies');
            const count = parseInt(res.rows[0].count);
            if (count === 0) {
                console.log('Seeding PostgreSQL database with realistic chemical solvent enterprise data...');
                await seedDatabase(client, true);
            } else {
                console.log('PostgreSQL database already initialized.');
            }

            // Seed customer portal users in PG if empty (MUST BE AFTER companies are seeded)
            try {
                const userCountRes = await client.query('SELECT COUNT(*) as count FROM customer_portal_users');
                const userCount = parseInt(userCountRes.rows[0].count);
                if (userCount === 0) {
                    console.log('Seeding customer portal users for active companies in PostgreSQL...');
                    const activeCoRes = await client.query("SELECT id, name FROM companies WHERE credit_status = 'Active'");
                    for (const co of activeCoRes.rows) {
                        const username = co.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) + '.user';
                        await client.query(
                            `INSERT INTO customer_portal_users (company_id, username, password, full_name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                            [co.id, username, 'shakti123', co.name + ' Portal User']
                        );
                    }
                    await client.query("UPDATE companies SET portal_login_enabled = 1 WHERE credit_status = 'Active'");
                }
            } catch (err) {
                console.warn('PostgreSQL customer portal user seeding warning:', err.message);
            }
        } finally {
            client.release();
        }
    } else {
        const db = await getDbConnection();
        await db.run('PRAGMA foreign_keys = ON');

        const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
        const cleanSql = schemaSql.replace(/--.*$/gm, '');
        const statements = cleanSql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        for (const statement of statements) {
            await db.run(statement);
        }

        // Run column migrations for SQLite if existing tables don't have them
        try {
            await db.run("ALTER TABLE companies ADD COLUMN portal_login_enabled INTEGER DEFAULT 0");
        } catch (e) {}
        try {
            await db.run("ALTER TABLE companies ADD COLUMN commitment_health_score REAL");
        } catch (e) {}
        try {
            await db.run("ALTER TABLE companies ADD COLUMN relationship_risk_flag INTEGER DEFAULT 0");
        } catch (e) {}
        try {
            await db.run("ALTER TABLE purchase_orders ADD COLUMN committed_dispatch_date DATE");
        } catch (e) {}
        try {
            await db.run("ALTER TABLE purchase_orders ADD COLUMN commitment_status TEXT DEFAULT 'Pending'");
        } catch (e) {}

        const row = await db.get('SELECT COUNT(*) as count FROM companies');
        if (row.count === 0) {
            console.log('Seeding SQLite database with realistic chemical solvent enterprise data...');
            await seedDatabase(db, false);
        } else {
            console.log('SQLite Database already initialized.');
        }

        // Seed customer portal users in SQLite if empty (MUST BE AFTER companies are seeded)
        try {
            const userCountRow = await db.get('SELECT COUNT(*) as count FROM customer_portal_users');
            if (userCountRow.count === 0) {
                console.log('Seeding customer portal users for active companies in SQLite...');
                const activeCos = await db.all("SELECT id, name FROM companies WHERE credit_status = 'Active'");
                for (const co of activeCos) {
                    const username = co.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) + '.user';
                    await db.run(
                        `INSERT OR IGNORE INTO customer_portal_users (company_id, username, password, full_name) VALUES (?, ?, ?, ?)`,
                        [co.id, username, 'shakti123', co.name + ' Portal User']
                    );
                }
                await db.run("UPDATE companies SET portal_login_enabled = 1 WHERE credit_status = 'Active'");
            }
        } catch (e) {
            console.warn('SQLite customer portal user seeding warning:', e.message);
        }
    }
}

async function seedDatabase(db, isPgConn) {
    const runQuery = async (sql, params = []) => {
        if (isPgConn) {
            let pgSql = sql;
            let count = 1;
            while (pgSql.includes('?')) {
                pgSql = pgSql.replace('?', `$${count++}`);
            }
            await db.query(pgSql, params);
        } else {
            await db.run(sql, params);
        }
    };

    const date30DaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const companies = [
        { id: 'COMP-001', name: 'Punjab Chemicals Ltd', tier: 'A', primary_products: JSON.stringify(['Acetone', 'Benzene']), contact_person: 'Harpreet Singh', contact_phone: '+91-98765-43210', credit_status: 'Active' },
        { id: 'COMP-002', name: 'Rajasthan Organics Corp', tier: 'B', primary_products: JSON.stringify(['DEP', 'Ethyl Acetate']), contact_person: 'Rajendra Prasad', contact_phone: '+91-87654-32109', credit_status: 'Active' },
        { id: 'COMP-003', name: 'Gujarat Industrial Paints', tier: 'A', primary_products: JSON.stringify(['Retarder', 'Toluene']), contact_person: 'Amit Shah', contact_phone: '+91-76543-21098', credit_status: 'Active' },
        { id: 'COMP-004', name: 'Deccan Solvent Distributors', tier: 'C', primary_products: JSON.stringify(['Acetone', 'Toluene']), contact_person: 'Venkat Rao', contact_phone: '+91-65432-10987', credit_status: 'Active' },
        { id: 'COMP-005', name: 'Alpha Pharmaceuticals Inc', tier: 'B', primary_products: JSON.stringify(['Benzene', 'DEP']), contact_person: 'Srinivas Murthy', contact_phone: '+91-54321-09876', credit_status: 'On Hold' },
        { id: 'COMP-006', name: 'Apex Logistics & Solvents', tier: 'C', primary_products: JSON.stringify(['Ethyl Acetate', 'Retarder']), contact_person: 'Vikram Malhotra', contact_phone: '+91-43210-98765', credit_status: 'Active' }
    ];

    for (const c of companies) {
        await runQuery(
            `INSERT INTO companies (id, name, tier, primary_products, contact_person, contact_phone, credit_status, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'System')`,
            [c.id, c.name, c.tier, c.primary_products, c.contact_person, c.contact_phone, c.credit_status, date30DaysAgo, date30DaysAgo]
        );
    }

    const historicalPOs = [
        { id: 'PO-HIST-001', company_id: 'COMP-004', date_received: '2026-04-10', status: 'Closed', product: 'Acetone', quantity: 10.0, allocated: 10.0 },
        { id: 'PO-HIST-002', company_id: 'COMP-004', date_received: '2026-05-15', status: 'Closed', product: 'Acetone', quantity: 12.0, allocated: 12.0 },
        { id: 'PO-HIST-003', company_id: 'COMP-001', date_received: '2026-05-01', status: 'Closed', product: 'Acetone', quantity: 30.0, allocated: 30.0 },
        { id: 'PO-HIST-004', company_id: 'COMP-001', date_received: '2026-05-20', status: 'Closed', product: 'Benzene', quantity: 25.0, allocated: 25.0 },
        { id: 'PO-HIST-005', company_id: 'COMP-003', date_received: '2026-05-10', status: 'Closed', product: 'Toluene', quantity: 40.0, allocated: 40.0 },
        { id: 'PO-HIST-006', company_id: 'COMP-002', date_received: '2026-05-25', status: 'Closed', product: 'DEP', quantity: 15.0, allocated: 15.0 }
    ];

    for (const po of historicalPOs) {
        await runQuery(
            `INSERT INTO purchase_orders (id, company_id, date_received, status, notes, created_at, updated_at, created_by)
             VALUES (?, ?, ?, 'Closed', 'Historical order seeded for averages', ?, ?, 'System')`,
            [po.id, po.company_id, po.date_received, po.date_received + ' 10:00:00', po.date_received + ' 17:00:00']
        );
        await runQuery(
            `INSERT INTO po_line_items (po_id, product_type, quantity, allocated_quantity, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [po.id, po.product, po.quantity, po.allocated, po.date_received + ' 10:00:00', po.date_received + ' 17:00:00']
        );
        
        const dspId = 'DSP-HIST-' + po.id.split('-')[2];
        await runQuery(
            `INSERT INTO dispatch_log (id, product_type, quantity, vehicle_id, planned_dispatch_date, actual_dispatch_date, status, created_at, updated_at)
             VALUES (?, ?, ?, 'VEH-HIST-01', ?, ?, 'Executed', ?, ?)`,
            [dspId, po.product, po.quantity, po.date_received, po.date_received, po.date_received + ' 10:00:00', po.date_received + ' 17:00:00']
        );

        if (isPgConn) {
            await db.query(
                `INSERT INTO dispatch_allocations (dispatch_id, po_id, po_line_item_id, quantity)
                 VALUES ($1, $2, (SELECT id FROM po_line_items WHERE po_id = $3 LIMIT 1), $4)`,
                [dspId, po.id, po.id, po.quantity]
            );
        } else {
            await db.run(
                `INSERT INTO dispatch_allocations (dispatch_id, po_id, po_line_item_id, quantity)
                 VALUES (?, ?, (SELECT id FROM po_line_items WHERE po_id = ? LIMIT 1), ?)`,
                [dspId, po.id, po.id, po.quantity]
            );
        }
    }

    const activePOs = [
        { id: 'PO-2026-001', company_id: 'COMP-001', date_received: '2026-06-25', status: 'Received', notes: 'Urgent requirement for pharma batch synthesis.', items: [{ product: 'Acetone', qty: 40.0 }, { product: 'Benzene', qty: 20.0 }] },
        { id: 'PO-2026-002', company_id: 'COMP-003', date_received: '2026-06-28', status: 'Received', notes: 'Requesting fast-track delivery. Special Retarder blend.', items: [{ product: 'Toluene', qty: 30.0 }, { product: 'Retarder', qty: 15.0 }] },
        { id: 'PO-2026-003', company_id: 'COMP-002', date_received: '2026-06-20', status: 'Partially Allocated', notes: 'Deliver to Udaipur plant.', items: [{ product: 'DEP', qty: 25.0, allocated: 10.0 }] },
        { id: 'PO-2026-004', company_id: 'COMP-004', date_received: '2026-06-15', status: 'Received', notes: 'Bulk purchase order for festival inventory.', items: [{ product: 'Acetone', qty: 50.0 }] },
        { id: 'PO-2026-005', company_id: 'COMP-005', date_received: '2026-06-27', status: 'Received', notes: 'Credit verification pending but order accepted.', items: [{ product: 'Benzene', qty: 15.0 }] }
    ];

    for (const po of activePOs) {
        const poDateStr = po.date_received + ' 10:00:00';
        await runQuery(
            `INSERT INTO purchase_orders (id, company_id, date_received, status, notes, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'System')`,
            [po.id, po.company_id, po.date_received, po.status, po.notes, poDateStr, poDateStr]
        );
        for (const item of po.items) {
            await runQuery(
                `INSERT INTO po_line_items (po_id, product_type, quantity, allocated_quantity, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [po.id, item.product, item.qty, item.allocated || 0, poDateStr, poDateStr]
            );
        }
    }

    const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await runQuery(
        `INSERT INTO dispatch_log (id, product_type, quantity, vehicle_id, planned_dispatch_date, status, created_at, updated_at)
         VALUES ('DSP-2026-003-PARTIAL', 'DEP', 10.0, 'VEH-PLN-99', '2026-06-28', 'Planned', ?, ?)`,
         [yesterdayDate, yesterdayDate]
    );

    if (isPgConn) {
        await db.query(
            `INSERT INTO dispatch_allocations (dispatch_id, po_id, po_line_item_id, quantity)
             VALUES ('DSP-2026-003-PARTIAL', 'PO-2026-003', (SELECT id FROM po_line_items WHERE po_id = 'PO-2026-003' LIMIT 1), 10.0)`
        );
    } else {
        await db.run(
            `INSERT INTO dispatch_allocations (dispatch_id, po_id, po_line_item_id, quantity)
             VALUES ('DSP-2026-003-PARTIAL', 'PO-2026-003', (SELECT id FROM po_line_items WHERE po_id = 'PO-2026-003' LIMIT 1), 10.0)`
        );
    }

    const products = ['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene'];
    const initialStocks = {
        Acetone: 150.0,
        Benzene: 100.0,
        DEP: 40.0,
        'Ethyl Acetate': 120.0,
        Retarder: 25.0,
        Toluene: 180.0
    };

    const systemDate = new Date('2026-06-29');
    let currentStocks = { ...initialStocks };

    for (let d = 30; d >= 0; d--) {
        const currentDate = new Date(systemDate);
        currentDate.setDate(systemDate.getDate() - d);
        const dateStr = currentDate.toISOString().split('T')[0];

        for (const prod of products) {
            const openStock = currentStocks[prod];
            
            let prodAdded = 0.0;
            const dayOfWeek = currentDate.getDay();
            if (dayOfWeek === 2 || dayOfWeek === 5) {
                prodAdded = prod === 'Acetone' ? 25.0 : prod === 'Benzene' ? 15.0 : prod === 'DEP' ? 8.0 : prod === 'Ethyl Acetate' ? 20.0 : prod === 'Retarder' ? 4.0 : 30.0;
            }
            
            let purchaseRec = 0.0;
            if (dayOfWeek === 4) {
                purchaseRec = prod === 'DEP' ? 10.0 : prod === 'Retarder' ? 5.0 : 0.0;
            }

            let dispOut = 0.0;
            if (dayOfWeek >= 1 && dayOfWeek <= 5 && d > 0) {
                dispOut = prod === 'Acetone' ? 12.0 : prod === 'Benzene' ? 8.0 : prod === 'DEP' ? 3.0 : prod === 'Ethyl Acetate' ? 10.0 : prod === 'Retarder' ? 2.0 : 15.0;
            }

            if (dateStr === '2026-06-28' && prod === 'DEP') {
                dispOut = 10.0;
            }

            const closeStock = Math.max(0, openStock + prodAdded + purchaseRec - dispOut);
            currentStocks[prod] = closeStock;

            const isConfirmed = d === 0 ? 0 : 1;
            const snapshotId = `${prod}_${dateStr}`;
            
            await runQuery(
                `INSERT INTO inventory_snapshots (id, product_type, date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [snapshotId, prod, dateStr, openStock, prodAdded, purchaseRec, dispOut, closeStock, isConfirmed, date30DaysAgo, date30DaysAgo]
            );
        }
    }

    const weeks = ['2026-06-15', '2026-06-22', '2026-06-29'];
    const plans = [
        { product: 'Acetone', planned: 50.0, actual: 48.0 },
        { product: 'Benzene', planned: 30.0, actual: 28.0 },
        { product: 'DEP', planned: 16.0, actual: 8.0 }, 
        { product: 'Ethyl Acetate', planned: 40.0, actual: 42.0 },
        { product: 'Retarder', planned: 8.0, actual: 8.0 },
        { product: 'Toluene', planned: 60.0, actual: 60.0 }
    ];

    for (const w of weeks) {
        for (const p of plans) {
            const actualQty = w === '2026-06-29' ? 0.0 : p.actual;
            await runQuery(
                `INSERT INTO production_plans (product_type, week_start_date, planned_quantity, actual_quantity, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [p.product, w, p.planned, actualQty, date30DaysAgo, date30DaysAgo]
            );
        }
    }

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
        await runQuery(
            `INSERT INTO system_settings (key, value) VALUES (?, ?)`,
            [s.key, s.value]
        );
    }
}
