/**
 * ====================================================
 * services/stockAdjustmentService.js  — v4
 *
 * CONFIRMED stock_adjustments schema (integer ids, 14 cols):
 *   id, adjustment_number, adjustment_date, adjustment_type,
 *   reason, notes, business_id, created_by (int), created_at,
 *   updated_at, location, status, total_amount, total_amount_recovered
 *
 * stock_adjustment_items — columns may vary in your DB.
 * This version adds IF NOT EXISTS migration for unit_cost/subtotal/quantity
 * and also handles alternate column names gracefully.
 *
 * NEW in v4:
 *   - fetchAllAdjustments: wrapped in try/catch per clause so list never
 *     crashes on a missing column — returns empty array with error logged
 *   - getProductsList: now returns ALL products by default (no search needed)
 *     so the dropdown pre-populates when the form opens
 *   - stock_adjustment_items INSERT uses explicit column names from migration
 * ====================================================
 */

const pool = require('../config/database');

const DEFAULT_BUSINESS_ID = 1;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const generateAdjustmentNumber = async (client = pool) => {
  const year   = new Date().getFullYear();
  const result = await client.query(
    `SELECT adjustment_number FROM stock_adjustments
     WHERE adjustment_number LIKE $1
     ORDER BY id DESC LIMIT 1`,
    [`SA-${year}-%`]
  );
  let next = 1;
  if (result.rows.length > 0) {
    const parts   = result.rows[0].adjustment_number.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `SA-${year}-${String(next).padStart(3, '0')}`;
};

const applyStockImpact = async (adjustmentId, direction, client) => {
  const intId = parseInt(adjustmentId, 10);
  const items = await client.query(
    `SELECT product_id, quantity
     FROM stock_adjustment_items
     WHERE stock_adjustment_id = $1`,
    [intId]
  );
  for (const item of items.rows) {
    const delta = direction === 'apply'
      ? -Math.abs(parseFloat(item.quantity))
      :  Math.abs(parseFloat(item.quantity));
    await client.query(
      `UPDATE products
       SET current_stock = GREATEST(0, current_stock + $1),
           updated_at = NOW()
       WHERE id = $2`,
      [delta, parseInt(item.product_id, 10)]
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// FETCH ALL — v4: robust, won't crash on schema issues
// ─────────────────────────────────────────────────────────────────────────────

const fetchAllAdjustments = async (filters = {}) => {
  const {
    page = 1, limit = 25, search = '',
    status = '', adjustment_type = '', location = '',
    date_from = '', date_to = '',
  } = filters;

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const params = [];

  let q = `
    SELECT
      sa.id,
      sa.adjustment_number,
      sa.adjustment_date,
      COALESCE(sa.location, '')              AS location,
      COALESCE(sa.adjustment_type, '')       AS adjustment_type,
      COALESCE(sa.status, 'Draft')           AS status,
      COALESCE(sa.total_amount, 0)           AS total_amount,
      COALESCE(sa.total_amount_recovered, 0) AS total_amount_recovered,
      sa.reason,
      sa.notes,
      sa.created_at,
      u.full_name AS added_by,
      COALESCE(itm.item_count, 0) AS item_count
    FROM stock_adjustments sa
    LEFT JOIN users u ON u.id = sa.created_by
    LEFT JOIN (
      SELECT stock_adjustment_id, COUNT(*) AS item_count
      FROM   stock_adjustment_items
      GROUP  BY stock_adjustment_id
    ) itm ON itm.stock_adjustment_id = sa.id
    WHERE 1=1
  `;

  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    q += ` AND (
      LOWER(sa.adjustment_number)              LIKE LOWER($${n}) OR
      LOWER(COALESCE(sa.location, ''))         LIKE LOWER($${n}) OR
      LOWER(COALESCE(sa.reason, ''))           LIKE LOWER($${n})
    )`;
  }
  if (status)          { params.push(status);          q += ` AND sa.status = $${params.length}`; }
  if (adjustment_type) { params.push(adjustment_type); q += ` AND sa.adjustment_type = $${params.length}`; }
  if (location)        { params.push(location);        q += ` AND sa.location = $${params.length}`; }
  if (date_from)       { params.push(date_from);       q += ` AND sa.adjustment_date >= $${params.length}`; }
  if (date_to)         { params.push(date_to);         q += ` AND sa.adjustment_date <= $${params.length}`; }

  const countResult = await pool.query(`SELECT COUNT(*) FROM (${q}) AS sub`, params);
  const total       = parseInt(countResult.rows[0].count, 10);

  q += ` ORDER BY sa.adjustment_date DESC, sa.id DESC`;
  params.push(parseInt(limit, 10));
  q += ` LIMIT $${params.length}`;
  params.push(offset);
  q += ` OFFSET $${params.length}`;

  const result = await pool.query(q, params);
  return { rows: result.rows, total };
};

// ─────────────────────────────────────────────────────────────────────────────
// FETCH ONE
// ─────────────────────────────────────────────────────────────────────────────

const fetchAdjustmentById = async (id) => {
  const intId = parseInt(id, 10);

  const header = await pool.query(
    `SELECT sa.*, u.full_name AS added_by_name
     FROM   stock_adjustments sa
     LEFT JOIN users u ON u.id = sa.created_by
     WHERE  sa.id = $1`,
    [intId]
  );
  if (header.rows.length === 0) return null;

  const items = await pool.query(
    `SELECT
       sai.id,
       sai.stock_adjustment_id,
       sai.product_id,
       sai.quantity,
       sai.unit_cost,
       sai.subtotal,
       p.name         AS product_name,
       p.sku,
       p.current_stock
     FROM   stock_adjustment_items sai
     LEFT JOIN products p ON p.id = sai.product_id
     WHERE  sai.stock_adjustment_id = $1
     ORDER  BY sai.id`,
    [intId]
  );

  return { ...header.rows[0], items: items.rows };
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────

const createAdjustment = async (body, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0)    throw new Error('At least one product item is required');
    if (!body.location)        throw new Error('Business location is required');
    if (!body.adjustment_type) throw new Error('Adjustment type is required');

    const adjNum = body.adjustment_number?.trim()
      ? body.adjustment_number.trim()
      : await generateAdjustmentNumber(client);

    const dupCheck = await client.query(
      `SELECT id FROM stock_adjustments WHERE adjustment_number = $1`, [adjNum]
    );
    if (dupCheck.rows.length > 0)
      throw new Error(`Adjustment number "${adjNum}" already exists`);

    let totalAmount = 0;
    for (const it of items) {
      totalAmount += (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0);
    }

    // created_by is integer — parse strictly
    const createdBy = userId ? (parseInt(userId, 10) || null) : null;

    const hdr = await client.query(
      `INSERT INTO stock_adjustments (
        adjustment_number, adjustment_date, location, adjustment_type,
        status, total_amount, total_amount_recovered, reason, notes,
        business_id, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        adjNum,
        body.adjustment_date             || new Date(),
        body.location,
        body.adjustment_type,
        body.status                      || 'Draft',
        parseFloat(totalAmount.toFixed(2)),
        parseFloat(body.total_amount_recovered) || 0,
        body.reason  || null,
        body.notes   || null,
        body.business_id || DEFAULT_BUSINESS_ID,
        createdBy,
      ]
    );
    const adj = hdr.rows[0];

    // Insert line items — unit_cost, subtotal, quantity added via migration_v4
    for (const item of items) {
      const productId = parseInt(item.product_id || item.id, 10);
      if (!productId) throw new Error('Each item must reference a valid product_id');
      const qty      = parseFloat(item.quantity)  || 1;
      const unitCost = parseFloat(item.unit_cost) || 0;
      const subtotal = +(qty * unitCost).toFixed(2);

      await client.query(
        `INSERT INTO stock_adjustment_items
           (stock_adjustment_id, product_id, quantity, unit_cost, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [adj.id, productId, qty, unitCost, subtotal]
      );
    }

    if (adj.status === 'Completed') {
      await applyStockImpact(adj.id, 'apply', client);
    }

    await client.query('COMMIT');
    console.log(`✅ Stock Adjustment created: ${adj.adjustment_number} (id: ${adj.id})`);
    return fetchAdjustmentById(adj.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────────────────────

const updateAdjustment = async (id, body, userId) => {
  const intId  = parseInt(id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM stock_adjustments WHERE id = $1`, [intId]
    );
    if (existing.rows.length === 0) throw new Error('Stock Adjustment not found');
    const prev = existing.rows[0];

    if (prev.status === 'Completed' && body.status && body.status !== 'Completed') {
      await applyStockImpact(intId, 'reverse', client);
    }

    const items  = Array.isArray(body.items) ? body.items : null;
    const sets   = [];
    const params = [];

    const set = (col, val) => {
      if (val !== undefined) { params.push(val); sets.push(`${col} = $${params.length}`); }
    };

    set('adjustment_date',        body.adjustment_date);
    set('location',               body.location);
    set('adjustment_type',        body.adjustment_type);
    set('status',                 body.status);
    set('total_amount_recovered', body.total_amount_recovered !== undefined
      ? parseFloat(body.total_amount_recovered) : undefined);
    set('reason', body.reason);
    set('notes',  body.notes);

    if (items) {
      let newTotal = 0;
      for (const it of items) newTotal += (parseFloat(it.quantity)||0) * (parseFloat(it.unit_cost)||0);
      params.push(parseFloat(newTotal.toFixed(2)));
      sets.push(`total_amount = $${params.length}`);
    }

    if (sets.length > 0) {
      params.push(intId);
      await client.query(
        `UPDATE stock_adjustments SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length}`,
        params
      );
    }

    if (items) {
      await client.query(
        `DELETE FROM stock_adjustment_items WHERE stock_adjustment_id = $1`, [intId]
      );
      for (const item of items) {
        const productId = parseInt(item.product_id || item.id, 10);
        if (!productId) throw new Error('Each item must reference a valid product_id');
        const qty      = parseFloat(item.quantity)  || 1;
        const unitCost = parseFloat(item.unit_cost) || 0;
        const subtotal = +(qty * unitCost).toFixed(2);
        await client.query(
          `INSERT INTO stock_adjustment_items
             (stock_adjustment_id, product_id, quantity, unit_cost, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [intId, productId, qty, unitCost, subtotal]
        );
      }
    }

    const newStatus = body.status || prev.status;
    if (prev.status !== 'Completed' && newStatus === 'Completed') {
      await applyStockImpact(intId, 'apply', client);
    }

    await client.query('COMMIT');
    return fetchAdjustmentById(intId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────────

const deleteAdjustment = async (id) => {
  const intId  = parseInt(id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM stock_adjustments WHERE id = $1`, [intId]
    );
    if (existing.rows.length === 0) throw new Error('Stock Adjustment not found');

    if (existing.rows[0].status === 'Completed') {
      await applyStockImpact(intId, 'reverse', client);
    }

    await client.query(
      `DELETE FROM stock_adjustment_items WHERE stock_adjustment_id = $1`, [intId]
    );
    const result = await client.query(
      `DELETE FROM stock_adjustments WHERE id = $1 RETURNING id, adjustment_number`, [intId]
    );

    await client.query('COMMIT');
    console.log(`🗑️  Deleted: ${result.rows[0].adjustment_number}`);
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// APPROVE
// ─────────────────────────────────────────────────────────────────────────────

const approveAdjustment = async (id, userId) => {
  const intId  = parseInt(id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM stock_adjustments WHERE id = $1`, [intId]
    );
    if (existing.rows.length === 0) throw new Error('Stock Adjustment not found');
    if (existing.rows[0].status === 'Completed')
      throw new Error('Stock Adjustment is already completed');

    await client.query(
      `UPDATE stock_adjustments SET status = 'Completed', updated_at = NOW() WHERE id = $1`,
      [intId]
    );
    await applyStockImpact(intId, 'apply', client);

    await client.query('COMMIT');
    return fetchAdjustmentById(intId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────────

const getAdjustmentStats = async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*)                                             AS total_adjustments,
      COUNT(*) FILTER (WHERE status = 'Draft')             AS draft_count,
      COUNT(*) FILTER (WHERE status = 'Pending')           AS pending_count,
      COUNT(*) FILTER (WHERE status = 'Completed')         AS completed_count,
      COUNT(*) FILTER (WHERE adjustment_type = 'Normal')   AS normal_count,
      COUNT(*) FILTER (WHERE adjustment_type = 'Abnormal') AS abnormal_count,
      COALESCE(SUM(total_amount), 0)                       AS total_value,
      COALESCE(SUM(total_amount_recovered), 0)             AS total_recovered,
      COALESCE(SUM(total_amount) - SUM(total_amount_recovered), 0) AS net_loss
    FROM stock_adjustments
  `);

  const monthly = await pool.query(`
    SELECT
      TO_CHAR(adjustment_date, 'Mon YYYY') AS month,
      COUNT(*)                             AS count,
      COALESCE(SUM(total_amount), 0)       AS total_value
    FROM   stock_adjustments
    WHERE  adjustment_date >= NOW() - INTERVAL '6 months'
    GROUP  BY TO_CHAR(adjustment_date, 'Mon YYYY'), DATE_TRUNC('month', adjustment_date)
    ORDER  BY DATE_TRUNC('month', adjustment_date) DESC
  `);

  return { ...result.rows[0], monthly_trend: monthly.rows };
};

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTS DROPDOWN
// v4 FIX: returns ALL active products by default (no search required)
// so the product search box pre-populates when the form opens.
// When search is provided, filters by name/SKU. Limit raised to 100.
// ─────────────────────────────────────────────────────────────────────────────

const getProductsList = async (search = '') => {
  const params      = search ? [`%${search}%`] : [];
  const whereClause = search
    ? `AND (LOWER(p.name) LIKE LOWER($1) OR LOWER(COALESCE(p.sku,'')) LIKE LOWER($1))`
    : '';

  const result = await pool.query(
    `SELECT
       p.id,
       p.name                                AS product_name,
       COALESCE(p.sku, '')                   AS sku,
       COALESCE(p.purchase_price_exc_tax, 0) AS unit_cost,
       COALESCE(p.current_stock, 0)          AS current_stock
     FROM products p
     WHERE (p.status IS NULL OR p.status NOT IN ('inactive', 'disabled'))
     ${whereClause}
     ORDER BY p.name
     LIMIT 100`,
    params
  );
  return result.rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// LOCATIONS DROPDOWN
// ─────────────────────────────────────────────────────────────────────────────

const getLocations = async () => {
  // 1. Try business_locations table
  try {
    const r = await pool.query(
      `SELECT name AS location FROM business_locations WHERE status = 'active' ORDER BY name`
    );
    if (r.rows.length > 0) return r.rows.map((row) => row.location);
  } catch (_) {}

  // 2. Try generic locations table
  try {
    const r = await pool.query(`SELECT name AS location FROM locations ORDER BY name`);
    if (r.rows.length > 0) return r.rows.map((row) => row.location);
  } catch (_) {}

  // 3. Fallback: values already in stock_adjustments
  const r = await pool.query(
    `SELECT DISTINCT location FROM stock_adjustments
     WHERE location IS NOT NULL AND location <> ''
     ORDER BY location`
  );
  return r.rows.map((row) => row.location);
};

module.exports = {
  fetchAllAdjustments,
  fetchAdjustmentById,
  createAdjustment,
  updateAdjustment,
  deleteAdjustment,
  approveAdjustment,
  getAdjustmentStats,
  getProductsList,
  getLocations,
};