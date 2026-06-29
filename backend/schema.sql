-- SQLite schema for Chemical Solvent Dispatch Planning Portal

-- 1. Company Master
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tier TEXT NOT NULL CHECK(tier IN ('A', 'B', 'C')),
    primary_products TEXT NOT NULL, -- JSON array of products: e.g. ["Acetone", "Toluene"]
    contact_person TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    credit_status TEXT NOT NULL DEFAULT 'Active' CHECK(credit_status IN ('Active', 'On Hold')),
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
    product_type TEXT NOT NULL CHECK(product_type IN ('Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene')),
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
    product_type TEXT NOT NULL CHECK(product_type IN ('Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene')),
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
    product_type TEXT NOT NULL CHECK(product_type IN ('Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene')),
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
    product_type TEXT NOT NULL CHECK(product_type IN ('Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene')),
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
