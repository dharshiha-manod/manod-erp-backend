/**
 * ====================================================
 * services/stockTransferService.js
 * Business logic & all SQL queries for the Stock Transfer
 * module. Controller stays thin — every DB call lives here.
 * Mirrors the style of services/purchaseService.js exactly.
 *
 * Matches the REAL existing schema:
 *   stock_transfers      : id, transfer_number, transfer_date,
 *                          location_from, location_to, status,
 *                          notes, business_id, created_by,
 *                          created_at, updated_at
 *   stock_transfer_items : id, stock_transfer_id, product_id,
 *                          quantity, created_at
 *   products              : id, name, sku, purchase_price_exc_tax,
 *                          selling_price_exc_tax, current_stock, ...
 *
 * NOTE: stock_transfer_items has no unit_cost/subtotal column,
 * so totals are computed on the fly by joining products.purchase_price_exc_tax.
 * ====================================================
 */

const pool = require('../config/database');

const DEFAULT_BUSINESS_ID = 1; // single-business setup for now

// ── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Auto-generate the next transfer number: ST-2026-001, ST-2026-002, …
 */
const generateTransferNumber = async () => {
  const year = new Date().getFullYear();
  const result = await pool.query(
    `SELECT transfer_number FROM stock_transfers
     WHERE transfer_number LIKE $1
     ORDER BY id DESC LIMIT 1`,
    [`ST-${year}-%`]
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].transfer_number.split('-').pop(), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `ST-${year}-${String(next).padStart(3, '0')}`;
};

// ── FETCH ALL STOCK TRANSFERS (paginated + filtered) ─────────────────────────
const fetchAllStockTransfers = async (filters = {}) => {
  const {
    page = 1, limit = 25, search = '',
    status = '', location_from = '', location_to = '',
    date_from = '', date_to = '',
  } = filters;

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  let q = `
    SELECT
      st.id, st.transfer_number, st.transfer_date,
      st.location_from, st.location_to, st.status, st.notes,
      st.created_at,
      u.full_name AS added_by,
      COALESCE(tot.total_amount, 0) AS total_amount,
      COALESCE(tot.item_count, 0)   AS item_count
    FROM stock_transfers st
    LEFT JOIN users u ON u.id = st.created_by
    LEFT JOIN (
      SELECT sti.stock_transfer_id,
             SUM(sti.quantity * COALESCE(p.purchase_price_exc_tax, 0)) AS total_amount,
             COUNT(*) AS item_count
      FROM stock_transfer_items sti
      LEFT JOIN products p ON p.id = sti.product_id
      GROUP BY sti.stock_transfer_id
    ) tot ON tot.stock_transfer_id = st.id
    WHERE 1=1
  `;
  const params = [];

 if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    q += ` AND (
      LOWER(st.transfer_number) LIKE LOWER($${n}) OR
      LOWER(st.location_from)   LIKE LOWER($${n}) OR
      LOWER(st.location_to)     LIKE LOWER($${n}) OR
      LOWER(st.status)          LIKE LOWER($${n}) OR
      LOWER(COALESCE(st.notes, '')) LIKE LOWER($${n})
    )`;
  }
  if (status) {
    params.push(status);
    q += ` AND st.status = $${params.length}`;
  }
  if (location_from) {
    params.push(location_from);
    q += ` AND st.location_from = $${params.length}`;
  }
  if (location_to) {
    params.push(location_to);
    q += ` AND st.location_to = $${params.length}`;
  }
  if (date_from) {
    params.push(date_from);
    q += ` AND st.transfer_date >= $${params.length}`;
  }
  if (date_to) {
    params.push(date_to);
    q += ` AND st.transfer_date <= $${params.length}`;
  }

  // Count before pagination (reuse the WHERE clause via a wrapped subquery)
  const countQ = `SELECT COUNT(*) FROM (${q}) AS sub`;
  const countResult = await pool.query(countQ, params);
  const total = parseInt(countResult.rows[0].count, 10);

  q += ` ORDER BY st.transfer_date DESC, st.id DESC`;
  params.push(parseInt(limit, 10));
  q += ` LIMIT $${params.length}`;
  params.push(offset);
  q += ` OFFSET $${params.length}`;

  const result = await pool.query(q, params);
  return { rows: result.rows, total };
};

// ── FETCH ONE STOCK TRANSFER (with items + product info) ─────────────────────
const fetchStockTransferById = async (id) => {
  const headerResult = await pool.query(
    `SELECT st.*, u.full_name AS added_by_name
     FROM stock_transfers st
     LEFT JOIN users u ON u.id = st.created_by
     WHERE st.id = $1`,
    [id]
  );
  if (headerResult.rows.length === 0) return null;

  const items = await pool.query(
    `SELECT
       sti.id, sti.stock_transfer_id, sti.product_id, sti.quantity,
       p.name AS product_name, p.sku, p.purchase_price_exc_tax AS cost_price,
       (sti.quantity * COALESCE(p.purchase_price_exc_tax, 0)) AS subtotal
     FROM stock_transfer_items sti
     LEFT JOIN products p ON p.id = sti.product_id
     WHERE sti.stock_transfer_id = $1
     ORDER BY sti.id`,
    [id]
  );

  const totalAmount = items.rows.reduce((s, r) => s + (parseFloat(r.subtotal) || 0), 0);

  return {
    ...headerResult.rows[0],
    items: items.rows,
    total_amount: +totalAmount.toFixed(2),
  };
};

// ── CREATE STOCK TRANSFER ─────────────────────────────────────────────────────
const createStockTransfer = async (body, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) throw new Error('At least one product item is required');

    if (!body.location_from || !body.location_to) {
      throw new Error('Both source and destination locations are required');
    }
    if (body.location_from === body.location_to) {
      throw new Error('Source and destination locations must be different');
    }

    const transferNumber = body.transfer_number?.trim()
      ? body.transfer_number.trim()
      : await generateTransferNumber();

    // Check transfer number uniqueness
    const dupCheck = await client.query(
      `SELECT id FROM stock_transfers WHERE transfer_number = $1`, [transferNumber]
    );
    if (dupCheck.rows.length > 0) throw new Error(`Transfer number "${transferNumber}" already exists`);

    const headerResult = await client.query(
      `INSERT INTO stock_transfers (
        transfer_number, transfer_date, location_from, location_to,
        status, notes, business_id, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8
      ) RETURNING *`,
      [
        transferNumber,
        body.transfer_date || new Date(),
        body.location_from,
        body.location_to,
        body.status            || 'Pending',
        body.notes             || body.additional_notes || null,
        body.business_id       || DEFAULT_BUSINESS_ID,
        userId                 || null,
      ]
    );

    const transfer = headerResult.rows[0];

    // Insert line items
    for (const item of items) {
      const productId = item.product_id || item.id;
      if (!productId) throw new Error('Each item must reference a valid product_id');
      const qty = parseFloat(item.quantity) || 1;

      await client.query(
        `INSERT INTO stock_transfer_items (
          stock_transfer_id, product_id, quantity
        ) VALUES ($1,$2,$3)`,
        [transfer.id, productId, qty]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ Stock Transfer created: ${transfer.transfer_number} (id: ${transfer.id})`);
    return fetchStockTransferById(transfer.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── UPDATE STOCK TRANSFER ─────────────────────────────────────────────────────
const updateStockTransfer = async (id, body, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(`SELECT * FROM stock_transfers WHERE id = $1`, [id]);
    if (existing.rows.length === 0) throw new Error('Stock Transfer not found');

    if (body.location_from && body.location_to && body.location_from === body.location_to) {
      throw new Error('Source and destination locations must be different');
    }

    const items = Array.isArray(body.items) ? body.items : null;

    // Build dynamic SET clause
    const sets   = [];
    const params = [];

    const setField = (col, val) => {
      if (val !== undefined) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    };

    setField('transfer_date',  body.transfer_date);
    setField('location_from',  body.location_from);
    setField('location_to',    body.location_to);
    setField('status',         body.status);
    setField('notes',          body.notes !== undefined ? body.notes : body.additional_notes);

    if (sets.length === 0 && !items) throw new Error('No fields to update');

    if (sets.length > 0) {
      params.push(id);
      await client.query(
        `UPDATE stock_transfers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
        params
      );
    }

    // Replace line items if provided
    if (items) {
      await client.query(`DELETE FROM stock_transfer_items WHERE stock_transfer_id = $1`, [id]);
      for (const item of items) {
        const productId = item.product_id || item.id;
        if (!productId) throw new Error('Each item must reference a valid product_id');
        const qty = parseFloat(item.quantity) || 1;

        await client.query(
          `INSERT INTO stock_transfer_items (
            stock_transfer_id, product_id, quantity
          ) VALUES ($1,$2,$3)`,
          [id, productId, qty]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Stock Transfer updated: id ${id}`);
    return fetchStockTransferById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── DELETE STOCK TRANSFER ─────────────────────────────────────────────────────
const deleteStockTransfer = async (id) => {
  // Delete items first as a safety net in case no ON DELETE CASCADE FK exists
  await pool.query(`DELETE FROM stock_transfer_items WHERE stock_transfer_id = $1`, [id]);
  const result = await pool.query(
    `DELETE FROM stock_transfers WHERE id = $1 RETURNING id, transfer_number`,
    [id]
  );
  if (result.rows.length === 0) throw new Error('Stock Transfer not found');
  console.log(`🗑️  Stock Transfer deleted: ${result.rows[0].transfer_number}`);
  return result.rows[0];
};

// ── DASHBOARD STATS ───────────────────────────────────────────────────────────
// NEW
const getStockTransferStats = async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*)                                          AS total_transfers,
      COUNT(*) FILTER (WHERE status = 'Pending')         AS pending_count,
      COUNT(*) FILTER (WHERE status = 'Completed')       AS completed_count,
      COUNT(*) FILTER (WHERE status = 'In Transit')      AS in_transit_count,
      COUNT(*) FILTER (WHERE status = 'Cancelled')        AS cancelled_count,
      (
        SELECT COALESCE(SUM(sti.quantity * COALESCE(p.purchase_price_exc_tax, 0)), 0)
        FROM stock_transfer_items sti
        LEFT JOIN products p ON p.id = sti.product_id
      )                                                   AS total_value
    FROM stock_transfers
  `);
  return result.rows[0];
};

// ── PRODUCTS DROPDOWN (for Add/Edit form item search) ─────────────────────────
const getProductsList = async () => {
  const result = await pool.query(
    `SELECT id, name AS product_name, sku,
            purchase_price_exc_tax AS cost_price,
            selling_price_exc_tax  AS selling_price,
            current_stock
     FROM products
     WHERE status IS NULL OR status NOT IN ('inactive', 'disabled')
     ORDER BY name`
  );
  return result.rows;
};

module.exports = {
  fetchAllStockTransfers,
  fetchStockTransferById,
  createStockTransfer,
  updateStockTransfer,
  deleteStockTransfer,
  getStockTransferStats,
  getProductsList,
};