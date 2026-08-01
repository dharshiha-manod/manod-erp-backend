const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function run() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/add_ess_leave_owner.sql'),
    'utf8'
  );
  try {
    await pool.query(sql);
    console.log('✅ ESS migration applied successfully (hrm_leaves.employee_id, employee_source)');
  } catch (err) {
    console.error('❌ ESS migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

run();