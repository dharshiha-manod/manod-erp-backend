const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function run() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/add_user_hrm_fields.sql'),
    'utf8'
  );
  try {
    await pool.query(sql);
    console.log('✅ Migration applied successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

run();