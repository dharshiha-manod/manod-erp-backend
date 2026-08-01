const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function run() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/fix_ess_attendance_leave_employee_id.sql'),
    'utf8'
  );
  try {
    await pool.query(sql);
    console.log('✅ ESS attendance/leave migration applied successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

run();