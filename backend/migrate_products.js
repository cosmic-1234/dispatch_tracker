import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'dispatch.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Opened database successfully.');
});

db.serialize(() => {
  db.run('PRAGMA foreign_keys = OFF');
  db.run('BEGIN TRANSACTION');

  try {
    // 1. Migrate po_line_items
    db.run('ALTER TABLE po_line_items RENAME TO po_line_items_old');
    db.run(`
      CREATE TABLE po_line_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id TEXT NOT NULL,
        product_type TEXT NOT NULL CHECK(product_type IN ('AA', 'SMO', 'KMO', 'RETARDER', 'SDS')),
        quantity REAL NOT NULL CHECK(quantity > 0),
        allocated_quantity REAL NOT NULL DEFAULT 0 CHECK(allocated_quantity >= 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT DEFAULT 'System',
        FOREIGN KEY(po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
      )
    `);
    db.run(`
      INSERT INTO po_line_items (id, po_id, product_type, quantity, allocated_quantity, created_at, updated_at, created_by)
      SELECT id, po_id,
        CASE 
          WHEN product_type = 'Ethyl Acetate' THEN 'AA'
          WHEN product_type = 'Retarder' THEN 'RETARDER'
          WHEN product_type = 'Toluene' THEN 'SMO'
          WHEN product_type = 'Benzene' THEN 'KMO'
          WHEN product_type = 'Acetone' THEN 'SDS'
          WHEN product_type = 'DEP' THEN 'SDS'
          ELSE product_type
        END,
        quantity, allocated_quantity, created_at, updated_at, created_by
      FROM po_line_items_old
    `);
    db.run('DROP TABLE po_line_items_old');
    console.log('Migrated po_line_items.');

    // 2. Migrate dispatch_log
    db.run('ALTER TABLE dispatch_log RENAME TO dispatch_log_old');
    db.run(`
      CREATE TABLE dispatch_log (
        id TEXT PRIMARY KEY,
        product_type TEXT NOT NULL CHECK(product_type IN ('AA', 'SMO', 'KMO', 'RETARDER', 'SDS')),
        quantity REAL NOT NULL CHECK(quantity > 0),
        vehicle_id TEXT NOT NULL,
        planned_dispatch_date DATE NOT NULL,
        actual_dispatch_date DATE,
        status TEXT NOT NULL DEFAULT 'Planned' CHECK(status IN ('Planned', 'Executed', 'Cancelled')),
        cancellation_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT DEFAULT 'System'
      )
    `);
    db.run(`
      INSERT INTO dispatch_log (id, product_type, quantity, vehicle_id, planned_dispatch_date, actual_dispatch_date, status, cancellation_reason, created_at, updated_at, created_by)
      SELECT id,
        CASE 
          WHEN product_type = 'Ethyl Acetate' THEN 'AA'
          WHEN product_type = 'Retarder' THEN 'RETARDER'
          WHEN product_type = 'Toluene' THEN 'SMO'
          WHEN product_type = 'Benzene' THEN 'KMO'
          WHEN product_type = 'Acetone' THEN 'SDS'
          WHEN product_type = 'DEP' THEN 'SDS'
          ELSE product_type
        END,
        quantity, vehicle_id, planned_dispatch_date, actual_dispatch_date, status, cancellation_reason, created_at, updated_at, created_by
      FROM dispatch_log_old
    `);
    db.run('DROP TABLE dispatch_log_old');
    console.log('Migrated dispatch_log.');

    // 3. Migrate inventory_snapshots
    db.run('ALTER TABLE inventory_snapshots RENAME TO inventory_snapshots_old');
    db.run(`
      CREATE TABLE inventory_snapshots (
        id TEXT PRIMARY KEY,
        product_type TEXT NOT NULL CHECK(product_type IN ('AA', 'SMO', 'KMO', 'RETARDER', 'SDS')),
        date DATE NOT NULL,
        opening_stock REAL NOT NULL CHECK(opening_stock >= 0),
        production_added REAL NOT NULL DEFAULT 0 CHECK(production_added >= 0),
        purchased_material_received REAL NOT NULL DEFAULT 0 CHECK(purchased_material_received >= 0),
        dispatched_out REAL NOT NULL DEFAULT 0 CHECK(dispatched_out >= 0),
        closing_stock REAL NOT NULL CHECK(closing_stock >= 0),
        confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT DEFAULT 'System',
        UNIQUE(product_type, date)
      )
    `);
    db.run(`
      INSERT OR REPLACE INTO inventory_snapshots (id, product_type, date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed, created_at, updated_at, created_by)
      SELECT 
        CASE 
          WHEN product_type = 'Ethyl Acetate' THEN 'AA'
          WHEN product_type = 'Retarder' THEN 'RETARDER'
          WHEN product_type = 'Toluene' THEN 'SMO'
          WHEN product_type = 'Benzene' THEN 'KMO'
          WHEN product_type = 'Acetone' THEN 'SDS'
          WHEN product_type = 'DEP' THEN 'SDS'
          ELSE product_type
        END || '_' || date,
        CASE 
          WHEN product_type = 'Ethyl Acetate' THEN 'AA'
          WHEN product_type = 'Retarder' THEN 'RETARDER'
          WHEN product_type = 'Toluene' THEN 'SMO'
          WHEN product_type = 'Benzene' THEN 'KMO'
          WHEN product_type = 'Acetone' THEN 'SDS'
          WHEN product_type = 'DEP' THEN 'SDS'
          ELSE product_type
        END,
        date, opening_stock, production_added, purchased_material_received, dispatched_out, closing_stock, confirmed, created_at, updated_at, created_by
      FROM inventory_snapshots_old
    `);
    db.run('DROP TABLE inventory_snapshots_old');
    console.log('Migrated inventory_snapshots.');

    // 4. Migrate production_plans
    db.run('ALTER TABLE production_plans RENAME TO production_plans_old');
    db.run(`
      CREATE TABLE production_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_type TEXT NOT NULL CHECK(product_type IN ('AA', 'SMO', 'KMO', 'RETARDER', 'SDS')),
        week_start_date DATE NOT NULL,
        planned_quantity REAL NOT NULL CHECK(planned_quantity >= 0),
        actual_quantity REAL NOT NULL DEFAULT 0 CHECK(actual_quantity >= 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT DEFAULT 'System',
        UNIQUE(product_type, week_start_date)
      )
    `);
    db.run(`
      INSERT OR REPLACE INTO production_plans (id, product_type, week_start_date, planned_quantity, actual_quantity, created_at, updated_at, created_by)
      SELECT id,
        CASE 
          WHEN product_type = 'Ethyl Acetate' THEN 'AA'
          WHEN product_type = 'Retarder' THEN 'RETARDER'
          WHEN product_type = 'Toluene' THEN 'SMO'
          WHEN product_type = 'Benzene' THEN 'KMO'
          WHEN product_type = 'Acetone' THEN 'SDS'
          WHEN product_type = 'DEP' THEN 'SDS'
          ELSE product_type
        END,
        week_start_date, planned_quantity, actual_quantity, created_at, updated_at, created_by
      FROM production_plans_old
    `);
    db.run('DROP TABLE production_plans_old');
    console.log('Migrated production_plans.');

    // 5. Migrate vendor_purchases
    db.run('ALTER TABLE vendor_purchases RENAME TO vendor_purchases_old');
    db.run(`
      CREATE TABLE vendor_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        invoice_no TEXT,
        vendor TEXT NOT NULL,
        material TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity >= 0),
        rate REAL,
        amount REAL,
        mapped_product TEXT NOT NULL CHECK(mapped_product IN ('AA', 'SMO', 'KMO', 'RETARDER', 'SDS', 'Other')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      INSERT INTO vendor_purchases (id, date, invoice_no, vendor, material, quantity, rate, amount, mapped_product, created_at)
      SELECT id, date, invoice_no, vendor, material, quantity, rate, amount,
        CASE 
          WHEN mapped_product = 'Ethyl Acetate' THEN 'AA'
          WHEN mapped_product = 'Retarder' THEN 'RETARDER'
          WHEN mapped_product = 'Toluene' THEN 'SMO'
          WHEN mapped_product = 'Benzene' THEN 'KMO'
          WHEN mapped_product = 'Acetone' THEN 'SDS'
          WHEN mapped_product = 'DEP' THEN 'SDS'
          ELSE mapped_product
        END,
        created_at
      FROM vendor_purchases_old
    `);
    db.run('DROP TABLE vendor_purchases_old');
    console.log('Migrated vendor_purchases.');

    // 6. Migrate system_settings keys
    db.run("DELETE FROM system_settings WHERE key IN ('min_threshold_AA', 'min_threshold_RETARDER', 'min_threshold_SMO', 'min_threshold_KMO', 'min_threshold_SDS')");
    db.run("UPDATE system_settings SET key = 'min_threshold_AA' WHERE key = 'min_threshold_Ethyl Acetate'");
    db.run("UPDATE system_settings SET key = 'min_threshold_RETARDER' WHERE key = 'min_threshold_Retarder'");
    db.run("UPDATE system_settings SET key = 'min_threshold_SMO' WHERE key = 'min_threshold_Toluene'");
    db.run("UPDATE system_settings SET key = 'min_threshold_KMO' WHERE key = 'min_threshold_Benzene'");
    db.run("UPDATE system_settings SET key = 'min_threshold_SDS' WHERE key = 'min_threshold_Acetone'");
    db.run("DELETE FROM system_settings WHERE key = 'min_threshold_DEP'");
    console.log('Migrated system_settings keys.');

    db.run('COMMIT', (err) => {
      if (err) {
        throw err;
      }
      console.log('Transaction committed successfully.');
      db.run('PRAGMA foreign_keys = ON');
      process.exit(0);
    });
  } catch (err) {
    console.error('Error executing transaction, rolling back:', err);
    db.run('ROLLBACK', () => {
      db.run('PRAGMA foreign_keys = ON');
      process.exit(1);
    });
  }
});
