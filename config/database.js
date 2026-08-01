/**
 * ====================================================
 * DATABASE CONFIGURATION
 * PostgreSQL Connection Pool for Supabase
 * ====================================================
 */

const { Pool } = require('pg');
require('dotenv').config();

// Create connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false  // Required for Supabase
  },
  statement_timeout: 15000,        // kill any query stuck > 15s
  query_timeout: 15000,
  connectionTimeoutMillis: 8000,   // fail fast if pool can't get a connection
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Connected to Supabase PostgreSQL!');
    release();
  }
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
});

module.exports = pool;