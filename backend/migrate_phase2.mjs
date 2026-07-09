/**
 * Phase 2 Schema Migration — uses same sqlite/sqlite3 driver as the app
 */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'dispatch.db');

const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
console.log('=== Phase 2 Database Migration ===');

// ─── 1. Migrate scenario_snapshots ────────────────────────────────────────────
console.log('\n[1] Checking scenario_snapshots...');
const scCols = await db.all("PRAGMA table_info(scenario_snapshots)");
const scColNames = scCols.map(c => c.name);
if (!scColNames.includes('name')) {
  console.log('  Old schema detected. Migrating...');
  await db.exec('DROP TABLE IF EXISTS scenario_snapshots_old');
  await db.exec('ALTER TABLE scenario_snapshots RENAME TO scenario_snapshots_old');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scenario_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      ai_narration TEXT,
      created_by TEXT DEFAULT 'Planner',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✅ scenario_snapshots recreated: (id, name, snapshot_json, ai_narration, created_by, created_at)');
} else {
  console.log('  ✅ Already on correct schema.');
}

// ─── 2. Migrate customer_portal_users ─────────────────────────────────────────
console.log('\n[2] Checking customer_portal_users...');
const cpCols = await db.all("PRAGMA table_info(customer_portal_users)");
const cpColNames = cpCols.map(c => c.name);
if (!cpColNames.includes('username')) {
  console.log('  Old schema detected. Migrating...');
  await db.exec('DROP TABLE IF EXISTS customer_portal_users_old');
  await db.exec('ALTER TABLE customer_portal_users RENAME TO customer_portal_users_old');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS customer_portal_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id)
    )
  `);
  console.log('  ✅ customer_portal_users recreated: (id, company_id, username, password, full_name, is_active)');
} else {
  console.log('  ✅ Already on correct schema.');
}

// ─── 3. Seed portal users ────────────────────────────────────────────────────
console.log('\n[3] Seeding portal users for active companies...');
const companies = await db.all("SELECT id, name, tier FROM companies WHERE credit_status = 'Active' ORDER BY tier");
let seeded = 0;
for (const co of companies) {
  const username = co.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) + '.user';
  try {
    await db.run(
      `INSERT OR IGNORE INTO customer_portal_users (company_id, username, password, full_name) VALUES (?, ?, ?, ?)`,
      [co.id, username, 'shakti123', co.name + ' Portal User']
    );
    console.log(`  Seeded: ${username} → ${co.id} (Tier ${co.tier})`);
    seeded++;
  } catch (e) {
    console.log(`  Skip ${username}: ${e.message}`);
  }
}

// Also enable portal_login_enabled for these companies
await db.run(
  `UPDATE companies SET portal_login_enabled = 1 WHERE credit_status = 'Active'`
);
console.log(`  ${seeded} users seeded. Portal login enabled for active companies.`);

await db.close();
console.log('\n=== Migration Complete ✅ ===');
