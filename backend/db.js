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
            // Check if database contains old product names and needs a clean wipe
            let needsWipe = false;
            try {
                const checkRes = await client.query("SELECT COUNT(*) as count FROM po_line_items WHERE product_type = 'Acetone'");
                if (parseInt(checkRes.rows[0].count) > 0) {
                    needsWipe = true;
                }
            } catch (e) {}
            
            if (needsWipe) {
                console.log('Old product names detected in PostgreSQL database. Wiping tables for a clean, relative date seed...');
                const dropTables = [
                    'dispatch_allocations', 'dispatch_log', 'po_line_items', 
                    'po_commitment_history', 'purchase_orders', 'inventory_snapshots', 
                    'production_plans', 'vendor_purchases', 'system_settings', 
                    'customer_portal_users', 'companies', 'customer_login_activity', 
                    'scenario_snapshots'
                ];
                for (const table of dropTables) {
                    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
                }
            }

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

            // Run product names migration for PG if old products exist
            try {
                console.log('Checking if PostgreSQL product migration is needed...');
                
                // Helper to drop any check constraints on a column
                const dropCheckConstraints = async (tableName, columnName) => {
                    try {
                        const checkRes = await client.query(`
                            SELECT tc.constraint_name 
                            FROM information_schema.table_constraints tc 
                            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
                            WHERE tc.constraint_type = 'CHECK' 
                              AND tc.table_name = $1 
                              AND ccu.column_name = $2
                        `, [tableName, columnName]);
                        for (const row of checkRes.rows) {
                            await client.query(\`ALTER TABLE \${tableName} DROP CONSTRAINT IF EXISTS \${row.constraint_name}\`);
                        }
                    } catch (err) {
                        console.warn(\`Warning dropping check constraints on \${tableName}.\${columnName}:\`, err.message);
                    }
                };

                // Drop check constraints first to avoid constraint violation during update
                await dropCheckConstraints('po_line_items', 'product_type');
                await dropCheckConstraints('dispatch_log', 'product_type');
                await dropCheckConstraints('inventory_snapshots', 'product_type');
                await dropCheckConstraints('production_plans', 'product_type');
                await dropCheckConstraints('vendor_purchases', 'mapped_product');

                // Update product names in po_line_items
                await client.query("UPDATE po_line_items SET product_type = 'SDS' WHERE product_type IN ('Acetone', 'DEP')");
                await client.query("UPDATE po_line_items SET product_type = 'KMO' WHERE product_type = 'Benzene'");
                await client.query("UPDATE po_line_items SET product_type = 'SMO' WHERE product_type = 'Toluene'");
                await client.query("UPDATE po_line_items SET product_type = 'AA' WHERE product_type = 'Ethyl Acetate'");
                await client.query("UPDATE po_line_items SET product_type = 'RETARDER' WHERE product_type = 'Retarder'");

                // Update product names in dispatch_log
                await client.query("UPDATE dispatch_log SET product_type = 'SDS' WHERE product_type IN ('Acetone', 'DEP')");
                await client.query("UPDATE dispatch_log SET product_type = 'KMO' WHERE product_type = 'Benzene'");
                await client.query("UPDATE dispatch_log SET product_type = 'SMO' WHERE product_type = 'Toluene'");
                await client.query("UPDATE dispatch_log SET product_type = 'AA' WHERE product_type = 'Ethyl Acetate'");
                await client.query("UPDATE dispatch_log SET product_type = 'RETARDER' WHERE product_type = 'Retarder'");

                // Update product names in inventory_snapshots
                await client.query("UPDATE inventory_snapshots SET product_type = 'SDS' WHERE product_type IN ('Acetone', 'DEP')");
                await client.query("UPDATE inventory_snapshots SET product_type = 'KMO' WHERE product_type = 'Benzene'");
                await client.query("UPDATE inventory_snapshots SET product_type = 'SMO' WHERE product_type = 'Toluene'");
                await client.query("UPDATE inventory_snapshots SET product_type = 'AA' WHERE product_type = 'Ethyl Acetate'");
                await client.query("UPDATE inventory_snapshots SET product_type = 'RETARDER' WHERE product_type = 'Retarder'");

                // Update product names in production_plans
                await client.query("UPDATE production_plans SET product_type = 'SDS' WHERE product_type IN ('Acetone', 'DEP')");
                await client.query("UPDATE production_plans SET product_type = 'KMO' WHERE product_type = 'Benzene'");
                await client.query("UPDATE production_plans SET product_type = 'SMO' WHERE product_type = 'Toluene'");
                await client.query("UPDATE production_plans SET product_type = 'AA' WHERE product_type = 'Ethyl Acetate'");
                await client.query("UPDATE production_plans SET product_type = 'RETARDER' WHERE product_type = 'Retarder'");

                // Update product names in vendor_purchases
                await client.query("UPDATE vendor_purchases SET mapped_product = 'SDS' WHERE mapped_product IN ('Acetone', 'DEP')");
                await client.query("UPDATE vendor_purchases SET mapped_product = 'KMO' WHERE mapped_product = 'Benzene'");
                await client.query("UPDATE vendor_purchases SET mapped_product = 'SMO' WHERE mapped_product = 'Toluene'");
                await client.query("UPDATE vendor_purchases SET mapped_product = 'AA' WHERE mapped_product = 'Ethyl Acetate'");
                await client.query("UPDATE vendor_purchases SET mapped_product = 'RETARDER' WHERE mapped_product = 'Retarder'");

                // Update companies primary products
                const cos = await client.query("SELECT id, primary_products FROM companies");
                for (const row of cos.rows) {
                    try {
                        let prods = JSON.parse(row.primary_products);
                        if (Array.isArray(prods)) {
                            let updated = prods.map(p => {
                                if (p === 'Acetone' || p === 'DEP') return 'SDS';
                                if (p === 'Benzene') return 'KMO';
                                if (p === 'Toluene') return 'SMO';
                                if (p === 'Ethyl Acetate') return 'AA';
                                if (p === 'Retarder') return 'RETARDER';
                                return p;
                            });
                            await client.query("UPDATE companies SET primary_products = $1 WHERE id = $2", [JSON.stringify(updated), row.id]);
                        }
                    } catch (e) {}
                }

                // Update system settings key thresholds
                await client.query("UPDATE system_settings SET key = 'min_threshold_SDS' WHERE key = 'min_threshold_Acetone'");
                await client.query("UPDATE system_settings SET key = 'min_threshold_KMO' WHERE key = 'min_threshold_Benzene'");
                await client.query("UPDATE system_settings SET key = 'min_threshold_AA' WHERE key = 'min_threshold_Ethyl Acetate'");
                await client.query("UPDATE system_settings SET key = 'min_threshold_RETARDER' WHERE key = 'min_threshold_Retarder'");
                await client.query("UPDATE system_settings SET key = 'min_threshold_SMO' WHERE key = 'min_threshold_Toluene'");
                await client.query("DELETE FROM system_settings WHERE key = 'min_threshold_DEP'");

                // Re-add check constraints with the new allowed products
                await client.query("ALTER TABLE po_line_items ADD CONSTRAINT po_line_items_product_type_check CHECK (product_type IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO'))");
                await client.query("ALTER TABLE dispatch_log ADD CONSTRAINT dispatch_log_product_type_check CHECK (product_type IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO'))");
                await client.query("ALTER TABLE inventory_snapshots ADD CONSTRAINT inventory_snapshots_product_type_check CHECK (product_type IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO'))");
                await client.query("ALTER TABLE production_plans ADD CONSTRAINT production_plans_product_type_check CHECK (product_type IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO'))");
                await client.query("ALTER TABLE vendor_purchases ADD CONSTRAINT vendor_purchases_mapped_product_check CHECK (mapped_product IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO', 'Other'))");

                console.log('PostgreSQL product migration completed successfully!');
            } catch (err) {
                console.error('PostgreSQL product migration error:', err.message);
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

    // Ensure OpenRouter key is set if not already set or if empty
    try {
        const envKey = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || '';
        if (envKey) {
            if (isPg) {
                const client = await pgPool.connect();
                try {
                    await client.query("UPDATE system_settings SET value = $1 WHERE key = 'anthropic_api_key' AND (value IS NULL OR value = '')", [envKey]);
                } finally {
                    client.release();
                }
            } else {
                const db = await getDbConnection();
                await db.run("UPDATE system_settings SET value = ? WHERE key = 'anthropic_api_key' AND (value IS NULL OR value = '')", [envKey]);
            }
        }
    } catch (e) {
        console.warn('System settings update warning:', e.message);
    }
}

async function seedDatabase(db, isPgConn) {
    const today = new Date();
    const formatDateRelative = (daysAgo) => {
        const d = new Date(today);
        d.setDate(today.getDate() - daysAgo);
        return d.toLocaleDateString('en-CA');
    };
    const getMonday = (d) => {
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.setDate(diff));
    };
    const getMondayRelative = (weeksAgo) => {
        const d = getMonday(new Date());
        d.setDate(d.getDate() - weeksAgo * 7);
        return d.toLocaleDateString('en-CA');
    };
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
        { id: 'COMP-001', name: 'Punjab Chemicals Ltd', tier: 'A', primary_products: JSON.stringify(['SDS', 'KMO']), contact_person: 'Harpreet Singh', contact_phone: '+91-98765-43210', credit_status: 'Active' },
        { id: 'COMP-002', name: 'Rajasthan Organics Corp', tier: 'B', primary_products: JSON.stringify(['SDS', 'AA']), contact_person: 'Rajendra Prasad', contact_phone: '+91-87654-32109', credit_status: 'Active' },
        { id: 'COMP-003', name: 'Gujarat Industrial Paints', tier: 'A', primary_products: JSON.stringify(['RETARDER', 'SMO']), contact_person: 'Amit Shah', contact_phone: '+91-76543-21098', credit_status: 'Active' },
        { id: 'COMP-004', name: 'Deccan Solvent Distributors', tier: 'C', primary_products: JSON.stringify(['SDS', 'SMO']), contact_person: 'Venkat Rao', contact_phone: '+91-65432-10987', credit_status: 'Active' },
        { id: 'COMP-005', name: 'Alpha Pharmaceuticals Inc', tier: 'B', primary_products: JSON.stringify(['KMO', 'SDS']), contact_person: 'Srinivas Murthy', contact_phone: '+91-54321-09876', credit_status: 'On Hold' },
        { id: 'COMP-006', name: 'Apex Logistics & Solvents', tier: 'C', primary_products: JSON.stringify(['AA', 'RETARDER']), contact_person: 'Vikram Malhotra', contact_phone: '+91-43210-98765', credit_status: 'Active' }
    ];

    for (const c of companies) {
        await runQuery(
            `INSERT INTO companies (id, name, tier, primary_products, contact_person, contact_phone, credit_status, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'System')`,
            [c.id, c.name, c.tier, c.primary_products, c.contact_person, c.contact_phone, c.credit_status, date30DaysAgo, date30DaysAgo]
        );
    }

    const historicalPOs = [
        { id: 'PO-HIST-001', company_id: 'COMP-004', date_received: formatDateRelative(80), status: 'Closed', product: 'SDS', quantity: 10.0, allocated: 10.0 },
        { id: 'PO-HIST-002', company_id: 'COMP-004', date_received: formatDateRelative(45), status: 'Closed', product: 'SDS', quantity: 12.0, allocated: 12.0 },
        { id: 'PO-HIST-003', company_id: 'COMP-001', date_received: formatDateRelative(59), status: 'Closed', product: 'SDS', quantity: 30.0, allocated: 30.0 },
        { id: 'PO-HIST-004', company_id: 'COMP-001', date_received: formatDateRelative(40), status: 'Closed', product: 'KMO', quantity: 25.0, allocated: 25.0 },
        { id: 'PO-HIST-005', company_id: 'COMP-003', date_received: formatDateRelative(50), status: 'Closed', product: 'SMO', quantity: 40.0, allocated: 40.0 },
        { id: 'PO-HIST-006', company_id: 'COMP-002', date_received: formatDateRelative(35), status: 'Closed', product: 'SDS', quantity: 15.0, allocated: 15.0 }
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
        { id: 'PO-2026-001', company_id: 'COMP-001', date_received: formatDateRelative(4), status: 'Received', notes: 'Urgent requirement for pharma batch synthesis.', items: [{ product: 'SDS', qty: 40.0 }, { product: 'KMO', qty: 20.0 }] },
        { id: 'PO-2026-002', company_id: 'COMP-003', date_received: formatDateRelative(1), status: 'Received', notes: 'Requesting fast-track delivery. Special Retarder blend.', items: [{ product: 'SMO', qty: 30.0 }, { product: 'RETARDER', qty: 15.0 }] },
        { id: 'PO-2026-003', company_id: 'COMP-002', date_received: formatDateRelative(9), status: 'Partially Allocated', notes: 'Deliver to Udaipur plant.', items: [{ product: 'SDS', qty: 25.0, allocated: 10.0 }] },
        { id: 'PO-2026-004', company_id: 'COMP-004', date_received: formatDateRelative(14), status: 'Received', notes: 'Bulk purchase order for festival inventory.', items: [{ product: 'SDS', qty: 50.0 }] },
        { id: 'PO-2026-005', company_id: 'COMP-005', date_received: formatDateRelative(2), status: 'Received', notes: 'Credit verification pending but order accepted.', items: [{ product: 'KMO', qty: 15.0 }] }
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
         VALUES ('DSP-2026-003-PARTIAL', 'SDS', 10.0, 'VEH-PLN-99', '2026-06-28', 'Planned', ?, ?)`,
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

    const products = ['AA', 'KMO', 'RETARDER', 'SDS', 'SMO'];
    const initialStocks = {
        AA: 120.0,
        KMO: 100.0,
        RETARDER: 25.0,
        SDS: 150.0,
        SMO: 180.0
    };

    const systemDate = new Date();
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
                prodAdded = prod === 'SDS' ? 33.0 : prod === 'KMO' ? 15.0 : prod === 'AA' ? 20.0 : prod === 'RETARDER' ? 4.0 : 30.0;
            }
            
            let purchaseRec = 0.0;
            if (dayOfWeek === 4) {
                purchaseRec = prod === 'SDS' ? 10.0 : prod === 'RETARDER' ? 5.0 : 0.0;
            }

            let dispOut = 0.0;
            if (dayOfWeek >= 1 && dayOfWeek <= 5 && d > 0) {
                dispOut = prod === 'SDS' ? 15.0 : prod === 'KMO' ? 8.0 : prod === 'AA' ? 10.0 : prod === 'RETARDER' ? 2.0 : 15.0;
            }

            if (dateStr === '2026-06-28' && prod === 'SDS') {
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

    const weeks = [getMondayRelative(2), getMondayRelative(1), getMondayRelative(0)];
    const plans = [
        { product: 'AA', planned: 40.0, actual: 42.0 },
        { product: 'KMO', planned: 30.0, actual: 28.0 },
        { product: 'RETARDER', planned: 8.0, actual: 8.0 },
        { product: 'SDS', planned: 66.0, actual: 56.0 },
        { product: 'SMO', planned: 60.0, actual: 60.0 }
    ];

    for (const w of weeks) {
        for (const p of plans) {
            const actualQty = w === getMondayRelative(0) ? 0.0 : p.actual;
            await runQuery(
                `INSERT INTO production_plans (product_type, week_start_date, planned_quantity, actual_quantity, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [p.product, w, p.planned, actualQty, date30DaysAgo, date30DaysAgo]
            );
        }
    }

    const settings = [
        { key: 'min_threshold_AA', value: '30.0' },
        { key: 'min_threshold_KMO', value: '40.0' },
        { key: 'min_threshold_RETARDER', value: '10.0' },
        { key: 'min_threshold_SDS', value: '50.0' },
        { key: 'min_threshold_SMO', value: '60.0' },
        { key: 'vehicle_capacity_mt', value: '32.0' },
        { key: 'system_date', value: formatDateRelative(0) },
        { key: 'anthropic_api_key', value: process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || '' }
    ];

    for (const s of settings) {
        await runQuery(
            `INSERT INTO system_settings (key, value) VALUES (?, ?)`,
            [s.key, s.value]
        );
    }
}
