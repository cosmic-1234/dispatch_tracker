-- SQLite schema for Chemical Solvent Dispatch Planning Portal

-- 1. Company Master
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tier TEXT NOT NULL CHECK(tier IN ('A', 'B', 'C')),
    primary_products TEXT NOT NULL, -- JSON array of products: e.g. ["AA", "SMO"]
    contact_person TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    credit_status TEXT NOT NULL DEFAULT 'Active' CHECK(credit_status IN ('Active', 'On Hold')),
    portal_login_enabled INTEGER DEFAULT 0,
    commitment_health_score REAL,
    relationship_risk_flag INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT DEFAULT 'System'
);

-- 2. Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY, -- e.g. PO-2026-0001
    company_id TEXT NOT NULL,
    date_received DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'Received' CHECK(status IN ('Received', 'Partially Allocated', 'Fully Allocated', 'Dispatched', 'Closed')),
    committed_dispatch_date DATE,
    commitment_status TEXT DEFAULT 'Pending',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT DEFAULT 'System',
    FOREIGN KEY(company_id) REFERENCES companies(id)
);

-- 3. PO Line Items
CREATE TABLE IF NOT EXISTS po_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id TEXT NOT NULL,
    product_type TEXT NOT NULL CHECK(product_type IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO')),
    quantity REAL NOT NULL CHECK(quantity > 0),
    allocated_quantity REAL NOT NULL DEFAULT 0 CHECK(allocated_quantity >= 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT DEFAULT 'System',
    FOREIGN KEY(po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

-- 4. Dispatch Log
CREATE TABLE IF NOT EXISTS dispatch_log (
    id TEXT PRIMARY KEY, -- e.g. DSP-2026-0001
    product_type TEXT NOT NULL CHECK(product_type IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO')),
    quantity REAL NOT NULL CHECK(quantity > 0),
    vehicle_id TEXT NOT NULL, -- Run ID / Vehicle ID
    planned_dispatch_date DATE NOT NULL,
    actual_dispatch_date DATE,
    status TEXT NOT NULL DEFAULT 'Planned' CHECK(status IN ('Planned', 'Executed', 'Cancelled')),
    cancellation_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT DEFAULT 'System'
);

-- 4b. Dispatch to PO Allocation mapping table (to associate dispatches with specific POs and track history)
CREATE TABLE IF NOT EXISTS dispatch_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispatch_id TEXT NOT NULL,
    po_id TEXT NOT NULL,
    po_line_item_id INTEGER NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(dispatch_id) REFERENCES dispatch_log(id) ON DELETE CASCADE,
    FOREIGN KEY(po_id) REFERENCES purchase_orders(id),
    FOREIGN KEY(po_line_item_id) REFERENCES po_line_items(id)
);

-- 5. Inventory Snapshots (one snapshot per product per day)
CREATE TABLE IF NOT EXISTS inventory_snapshots (
    id TEXT PRIMARY KEY, -- e.g. Acetone_2026-06-29
    product_type TEXT NOT NULL CHECK(product_type IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO')),
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
);

-- 6. Production Plan (week-wise)
CREATE TABLE IF NOT EXISTS production_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_type TEXT NOT NULL CHECK(product_type IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO')),
    week_start_date DATE NOT NULL, -- e.g. Monday's date
    planned_quantity REAL NOT NULL CHECK(planned_quantity >= 0),
    actual_quantity REAL NOT NULL DEFAULT 0 CHECK(actual_quantity >= 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT DEFAULT 'System',
    UNIQUE(product_type, week_start_date)
);

-- 7. System Settings / Key-Value Store
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. Planner Override Log
CREATE TABLE IF NOT EXISTS planner_override_log (
    override_id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispatch_id TEXT,
    po_id TEXT,
    ai_recommended_qty REAL,
    planner_actual_qty REAL,
    override_reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    planner_id TEXT
);

-- 9. PO Commitment History
CREATE TABLE IF NOT EXISTS po_commitment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id TEXT NOT NULL,
    committed_date DATE,
    status TEXT,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

-- 10. Customer Portal Users
CREATE TABLE IF NOT EXISTS customer_portal_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id)
);

-- 11. Customer Login Activity
CREATE TABLE IF NOT EXISTS customer_login_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    session_duration INTEGER,
    FOREIGN KEY(company_id) REFERENCES companies(id)
);

-- 12. Scenario Snapshots (What-If Simulator)
CREATE TABLE IF NOT EXISTS scenario_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    ai_narration TEXT,
    created_by TEXT DEFAULT 'Planner',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. Vendor Purchases (Raw Material Receipts)
CREATE TABLE IF NOT EXISTS vendor_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    invoice_no TEXT,
    vendor TEXT NOT NULL,
    material TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity >= 0),
    rate REAL,
    amount REAL,
    mapped_product TEXT NOT NULL CHECK(mapped_product IN ('AA', 'KMO', 'RETARDER', 'SDS', 'SMO', 'Other')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

