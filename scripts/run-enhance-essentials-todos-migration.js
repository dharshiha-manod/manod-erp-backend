const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function run() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/enhance_essentials_todos.sql'),
    'utf8'
  );
  try {
    await pool.query(sql);
    console.log('✅ Essentials To Do enterprise migration applied successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

run();