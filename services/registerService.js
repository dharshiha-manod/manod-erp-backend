'use strict';
const pool = require('../config/database');
const { logActivity } = require('./activityLogService');

// Open a new shift for a cashier
const openSession = async ({ cashier_id, location, shift, opening_balance }) => {
  if (!cashier_id) throw new Error('Cashier is required');
  const existing = await pool.query(
    `SELECT id FROM register_sessions WHERE cashier_id=$1 AND status='open'`,
    [cashier_id]
  );
  if (existing.rows[0]) throw new Error('This cashier already has an open shift');

  const r = await pool.query(
    `INSERT INTO register_sessions (location, cashier_id, shift, opening_balance, status, opened_at, created_at)
     VALUES ($1,$2,$3,$4,'open',NOW(),NOW()) RETURNING *`,
    [location || null, cashier_id, shift || 'Morning', opening_balance || 0]
  );
  logActivity({ userId: cashier_id, module: 'POS', action: `Opened Register Shift`, detail: `Opening balance: ₹${opening_balance || 0}` });
  return r.rows[0];
};

// Record a manual cash in/out during a shift
const addCashMovement = async (sessionId, { type, amount, reason }) => {
  if (!['in', 'out'].includes(type)) throw new Error('Type must be "in" or "out"');
  if (!amount || amount <= 0) throw new Error('Amount must be greater than 0');

  const sessRes = await pool.query(`SELECT * FROM register_sessions WHERE id=$1`, [sessionId]);
  const session = sessRes.rows[0];
  if (!session) throw new Error('Register session not found');
  if (session.status !== 'open') throw new Error('Cannot add cash movement to a closed shift');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO register_cash_movements (session_id, type, amount, reason, created_at)
       VALUES ($1,$2,$3,$4,NOW())`,
      [sessionId, type, amount, reason || null]
    );
    const column = type === 'in' ? 'cash_in' : 'cash_out';
    await client.query(
      `UPDATE register_sessions SET ${column} = ${column} + $1, updated_at=NOW() WHERE id=$2`,
      [amount, sessionId]
    );
    await client.query('COMMIT');
    const updated = await pool.query(`SELECT * FROM register_sessions WHERE id=$1`, [sessionId]);
    logActivity({ userId: session.cashier_id, module: 'POS', action: `Cash ${type === 'in' ? 'In' : 'Out'}`, detail: `₹${amount}${reason ? ' — ' + reason : ''}` });
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Close a shift — locks in closing balance and total sales from actual POS sales
const closeSession = async (sessionId, { closing_balance, notes }) => {
  const sessRes = await pool.query(`SELECT * FROM register_sessions WHERE id=$1`, [sessionId]);
  const session = sessRes.rows[0];
  if (!session) throw new Error('Register session not found');
  if (session.status === 'closed') throw new Error('Shift already closed');
// Real total sales = POS sales created by this cashier during this session window
  const salesRes = await pool.query(
    `SELECT COALESCE(SUM(grand_total), 0) AS total
     FROM sales_invoices
     WHERE added_by::text = $1::text AND created_at >= $2 AND created_at <= NOW()`,
    [session.cashier_id, session.opened_at]
  );
  const totalSales = parseFloat(salesRes.rows[0].total) || 0;

  const r = await pool.query(
    `UPDATE register_sessions
     SET closing_balance=$1, total_sales=$2, notes=$3, status='closed', closed_at=NOW(), updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [closing_balance, totalSales, notes || null, sessionId]
  );
  logActivity({ userId: session.cashier_id, module: 'POS', action: `Closed Register Shift`, detail: `Closing balance: ₹${closing_balance}, Sales: ₹${totalSales}` });
  return r.rows[0];
};

const getOpenSessionForCashier = (cashierId) =>
  pool.query(`SELECT * FROM register_sessions WHERE cashier_id=$1 AND status='open'`, [cashierId]).then(r => r.rows[0] || null);

const getSessionById = (id) =>
  pool.query(`SELECT * FROM register_sessions WHERE id=$1`, [id]).then(r => r.rows[0] || null);

module.exports = {
  openSession,
  addCashMovement,
  closeSession,
  getOpenSessionForCashier,
  getSessionById,
};