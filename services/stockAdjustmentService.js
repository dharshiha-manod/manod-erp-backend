/**
 * services/stockAdjustmentService.js  — CORRECT FINAL
 *
 * Confirmed real schema:
 *   users.id    = UUID   → created_by UUID,   JOIN u.id = sa.created_by (both UUID ✓)
 *   products.id = INTEGER → product_id INTEGER, JOIN p.id = sai.product_id (both int ✓)
 */

'use strict';

const pool = require('../config/database');
const notificationEngine = require('./notificationEngine');
const { logAudit } = require('./auditLogService');

// ── Reference number ──────────────────────────────────────────────────────────
const generateReferenceNo = async (industryId, client = pool) => {
  const year   = new Date().getFullYear();
  const result = await client.query(
    `SELECT reference_no FROM stock_adjustments
     WHERE  reference_no LIKE $1 AND industry_id = $2 ORDER BY id DESC LIMIT 1`,
    [`SA-${year}-%`, industryId]
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].reference_no.split('-').pop(), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `SA-${year}-${String(next).padStart(3, '0')}`;
};

const stockLocationService = require('./stockLocationService');

const resolveLocationId = async (client, locationName, industryId) => {
  if (!locationName) return null;
  const r = await client.query(
    `SELECT id FROM business_locations WHERE location_name = $1 AND industry_id = $2`,
    [locationName, industryId]
  );
  return r.rows[0]?.id || null;
};

// ── Stock impact ──────────────────────────────────────────────────────────────
// direction 'apply' always represents a write-off/loss (this module is for
// Normal/Abnormal stock loss adjustments, not additions) — so it always
// decrements. 'reverse' undoes a previously-applied adjustment (e.g. on
// delete or status rollback), so it credits the stock back.
//
// locationId is required so the change lands on product_stock_by_location
// (the table purchase returns / transfers / sales actually check), not just
// the products.current_stock rollup — previously only the rollup was
// touched, so a location's own stock never reflected adjustments made there.
const applyStockImpact = async (adjustmentId, direction, client, locationId = null) => {
  const items = await client.query(
    `SELECT product_id, quantity FROM stock_adjustment_items
     WHERE  stock_adjustment_id = $1`,
    [adjustmentId]
  );
  for (const item of items.rows) {
    const delta = direction === 'apply'
      ? -Math.abs(parseFloat(item.quantity))
      :  Math.abs(parseFloat(item.quantity));

    if (locationId) {
      // Keeps product_stock_by_location AND products.current_stock in sync
      // (adjustStockAtLocation updates both) — same helper purchases,
      // transfers, and sales use, so all stock movement stays consistent.
      // allowNegative: true here because the negative-stock guard already
      // ran against products.current_stock in createAdjustment; we don't
      // want a location-level mismatch to block a legitimately-approved
      // adjustment mid-transaction.
      await stockLocationService.adjustStockAtLocation(client, item.product_id, locationId, delta, { allowNegative: true });
    } else {
      // No location on this adjustment (older rows before locationId was
      // tracked) — fall back to the old rollup-only behavior.
      await client.query(
        `UPDATE products
         SET    current_stock = GREATEST(0, COALESCE(current_stock, 0) + $1),
                updated_at    = NOW()
         WHERE  id = $2`,
        [delta, item.product_id]
      );
    }

    // Stock only went DOWN when direction === 'apply' — that's the only
    // case that can newly cross the low-stock threshold, so only check then.
    // Non-blocking, same pattern as sellService.js.
    if (direction === 'apply') {
      notificationEngine.checkAndAlertLowStock(item.product_id).catch(err =>
        console.error('[StockAdjustment] low stock alert check failed:', err.message)
      );
    }
  }
};

// ── FETCH ALL ─────────────────────────────────────────────────────────────────
const fetchAllAdjustments = async (industryId, filters = {}) => {
  const {
    page = 1, limit = 25, search = '',
    status = '', adjustment_type = '', location = '',
    date_from = '', date_to = '',
  } = filters;

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const params = [industryId];

  // users.id = UUID, sa.created_by = UUID → JOIN works fine
  let q = `
    SELECT
      sa.id, sa.reference_no, sa.adjustment_date,
      sa.location, sa.adjustment_type, sa.status,
      sa.total_amount, sa.total_amount_recovered,
      sa.reason, sa.created_at,
      u.full_name                 AS added_by,
      COALESCE(itm.item_count, 0) AS item_count
    FROM  stock_adjustments sa
    LEFT  JOIN users u ON u.id = sa.created_by
    LEFT  JOIN (
      SELECT stock_adjustment_id, COUNT(*) AS item_count
      FROM   stock_adjustment_items GROUP BY stock_adjustment_id
    ) itm ON itm.stock_adjustment_id = sa.id
    WHERE sa.industry_id = $1
  `;

  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    q += ` AND (LOWER(sa.reference_no) LIKE LOWER($${n})
            OR  LOWER(sa.location)     LIKE LOWER($${n})
            OR  LOWER(sa.reason)       LIKE LOWER($${n}))`;
  }
  if (status)          { params.push(status);          q += ` AND sa.status = $${params.length}`; }
  if (adjustment_type) { params.push(adjustment_type); q += ` AND sa.adjustment_type = $${params.length}`; }
  if (location)        { params.push(location);        q += ` AND sa.location = $${params.length}`; }
  if (date_from)       { params.push(date_from);       q += ` AND sa.adjustment_date >= $${params.length}`; }
  if (date_to)         { params.push(date_to);         q += ` AND sa.adjustment_date <= $${params.length}`; }

  const countRes = await pool.query(`SELECT COUNT(*) FROM (${q}) sub`, params);
  const total    = parseInt(countRes.rows[0].count, 10);

  q += ` ORDER BY sa.adjustment_date DESC, sa.id DESC`;
  params.push(parseInt(limit, 10)); q += ` LIMIT $${params.length}`;
  params.push(offset);              q += ` OFFSET $${params.length}`;

  const result = await pool.query(q, params);
  return { rows: result.rows, total };
};

// ── FETCH ONE ─────────────────────────────────────────────────────────────────
const fetchAdjustmentById = async (id, industryId) => {
  const hdr = await pool.query(
    `SELECT sa.*, u.full_name AS added_by_name
     FROM   stock_adjustments sa
     LEFT   JOIN users u ON u.id = sa.created_by
     WHERE  sa.id = $1 AND sa.industry_id = $2`,
    [id, industryId]
  );
  if (hdr.rows.length === 0) return null;

  const items = await pool.query(
    `SELECT sai.id, sai.stock_adjustment_id, sai.product_id,
            sai.quantity, sai.unit_cost, sai.subtotal,
            p.name AS product_name, p.sku, p.current_stock
     FROM   stock_adjustment_items sai
     LEFT   JOIN products p ON p.id = sai.product_id
     WHERE  sai.stock_adjustment_id = $1 ORDER BY sai.id`,
    [id]
  );
  return { ...hdr.rows[0], items: items.rows };
};

// ── CREATE ────────────────────────────────────────────────────────────────────
const createAdjustment = async (industryId, body, userId, userName) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const items = Array.isArray(body.items) ? body.items : [];
    if (!body.location)        throw new Error('Business location is required');
    if (!body.adjustment_type) throw new Error('Adjustment type is required');
    if (items.length === 0)    throw new Error('At least one product item is required');

    const refNo = body.reference_no?.trim() || await generateReferenceNo(industryId, client);
    const dup   = await client.query(
      `SELECT id FROM stock_adjustments WHERE reference_no = $1 AND industry_id = $2`, [refNo, industryId]
    );
    if (dup.rows.length > 0) throw new Error(`Reference no "${refNo}" already exists`);

    let totalAmount = 0;
    for (const it of items) {
      totalAmount += (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0);
    }

    // Block adjustments that would take any product's stock negative
    // (scoped to this industry — a product id from another workspace must not resolve)
    for (const it of items) {
      const productId = parseInt(it.product_id || it.id, 10);
      const qty       = parseFloat(it.quantity) || 0;
      const prodRes    = await client.query(
        `SELECT name, COALESCE(current_stock,0) AS current_stock FROM products WHERE id = $1 AND industry_id = $2`,
        [productId, industryId]
      );
      if (prodRes.rows.length === 0) throw new Error(`Product not found (id: ${productId})`);
      const { name, current_stock } = prodRes.rows[0];
      if (current_stock - qty < 0) {
        throw new Error(`Insufficient stock for "${name}": current stock is ${current_stock}, cannot adjust by ${qty}`);
      }
    }
    // Reject a location string that isn't a real registered business location
    // IN THIS INDUSTRY — same guard used in stockTransferService.createStockTransfer.
    const locCheck = await client.query(
      `SELECT id FROM business_locations WHERE location_name = $1 AND industry_id = $2`,
      [body.location, industryId]
    );
    if (locCheck.rows.length === 0) {
      throw new Error(`Location "${body.location}" does not exist in this Industry's Business Locations`);
    }
    // created_by = UUID — use $10::uuid so string from JWT is cast properly
    const hdrRes = await client.query(
      `INSERT INTO stock_adjustments
         (reference_no, adjustment_date, location, adjustment_type,
          status, total_amount, total_amount_recovered, reason,
          business_id, created_by, industry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11)
       RETURNING *`,
      [
        refNo,
        body.adjustment_date || new Date().toISOString().split('T')[0],
        body.location,
        body.adjustment_type,
        body.status || 'Draft',
        totalAmount.toFixed(2),
        parseFloat(body.total_amount_recovered) || 0,
        body.reason || null,
        1,
        userId || null,
        industryId,
      ]
    );
    const adj = hdrRes.rows[0];

    for (const item of items) {
      // product_id is INTEGER — parse it as int, no UUID cast
      const productId = parseInt(item.product_id || item.id, 10);
      if (!productId || isNaN(productId)) throw new Error('Each item must reference a valid product_id');
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
      await applyStockImpact(adj.id, 'apply', client, locCheck.rows[0].id);
    }
await client.query('COMMIT');
    const created = await fetchAdjustmentById(adj.id, industryId);

    logAudit({
      userId, userName,
      module: 'Stock Adjustments',
      action: 'CREATE',
      recordId: adj.id,
      recordLabel: adj.reference_no,
      oldData: null,
      newData: created,
    }).catch(() => {});

    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── UPDATE ────────────────────────────────────────────────────────────────────
const updateAdjustment = async (industryId, id, body, userId, userName) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(`SELECT * FROM stock_adjustments WHERE id=$1 AND industry_id=$2`, [id, industryId]);
    if (existing.rows.length === 0) throw new Error('Stock Adjustment not found');
    const prev = existing.rows[0];
    const oldData = prev;

    if (prev.status === 'Completed' && body.status && body.status !== 'Completed') {
      const locId = await resolveLocationId(client, prev.location, industryId);
      await applyStockImpact(id, 'reverse', client, locId);
    }

   const items  = Array.isArray(body.items) ? body.items : null;

    // Block adjustments that would take any product's stock negative
    // (only check when items are being changed and status isn't already Completed,
    //  since a Completed adjustment's stock impact is already applied/reflected)
    if (items && prev.status !== 'Completed') {
      for (const it of items) {
        const productId = parseInt(it.product_id || it.id, 10);
        const qty        = parseFloat(it.quantity) || 0;
        const prodRes     = await client.query(
          `SELECT name, COALESCE(current_stock,0) AS current_stock FROM products WHERE id = $1 AND industry_id = $2`,
          [productId, industryId]
        );
        if (prodRes.rows.length === 0) throw new Error(`Product not found (id: ${productId})`);
        const { name, current_stock } = prodRes.rows[0];
        if (current_stock - qty < 0) {
          throw new Error(`Insufficient stock for "${name}": current stock is ${current_stock}, cannot adjust by ${qty}`);
        }
      }
    }
    const sets   = [];
    const params = [];
    const add    = (col, val) => { if (val !== undefined) { params.push(val); sets.push(`${col}=$${params.length}`); } };

    add('adjustment_date',        body.adjustment_date);
    add('location',               body.location);
    add('adjustment_type',        body.adjustment_type);
    add('status',                 body.status);
    add('total_amount_recovered', body.total_amount_recovered);
    add('reason',                 body.reason);

    if (items) {
      let t = 0;
      for (const it of items) t += (parseFloat(it.quantity)||0) * (parseFloat(it.unit_cost)||0);
      params.push(t.toFixed(2));
      sets.push(`total_amount=$${params.length}`);
    }

    if (sets.length > 0) {
      params.push(id, industryId);
      await client.query(
        `UPDATE stock_adjustments SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length - 1} AND industry_id=$${params.length}`,
        params
      );
    }

    if (items) {
      await client.query(`DELETE FROM stock_adjustment_items WHERE stock_adjustment_id=$1`, [id]);
      for (const item of items) {
        const productId = parseInt(item.product_id || item.id, 10);
        if (!productId || isNaN(productId)) throw new Error('Each item must reference a valid product_id');
        const qty = parseFloat(item.quantity)||1, uc = parseFloat(item.unit_cost)||0;
        await client.query(
          `INSERT INTO stock_adjustment_items (stock_adjustment_id,product_id,quantity,unit_cost,subtotal)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, productId, qty, uc, +(qty*uc).toFixed(2)]
        );
      }
    }

    const newStatus = body.status || prev.status;
    if (prev.status !== 'Completed' && newStatus === 'Completed') {
      const finalLocation = body.location || prev.location;
      const locId = await resolveLocationId(client, finalLocation, industryId);
      await applyStockImpact(id, 'apply', client, locId);
    }
await client.query('COMMIT');
    const updated = await fetchAdjustmentById(id, industryId);

    logAudit({
      userId, userName,
      module: 'Stock Adjustments',
      action: 'UPDATE',
      recordId: id,
      recordLabel: updated?.reference_no || String(id),
      oldData,
      newData: updated,
    }).catch(() => {});

    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── DELETE ────────────────────────────────────────────────────────────────────
const deleteAdjustment = async (industryId, id, userId, userName) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ex = await client.query(`SELECT * FROM stock_adjustments WHERE id=$1 AND industry_id=$2`, [id, industryId]);
    if (ex.rows.length === 0) throw new Error('Stock Adjustment not found');
    const oldData = ex.rows[0];
    if (ex.rows[0].status === 'Completed') {
      const locId = await resolveLocationId(client, ex.rows[0].location, industryId);
      await applyStockImpact(id, 'reverse', client, locId);
    }
    await client.query(`DELETE FROM stock_adjustment_items WHERE stock_adjustment_id=$1`, [id]);
    const r = await client.query(`DELETE FROM stock_adjustments WHERE id=$1 AND industry_id=$2 RETURNING id,reference_no`, [id, industryId]);
    await client.query('COMMIT');

    logAudit({
      userId, userName,
      module: 'Stock Adjustments',
      action: 'DELETE',
      recordId: id,
      recordLabel: r.rows[0].reference_no,
      oldData,
      newData: null,
    }).catch(() => {});

    return r.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── APPROVE ───────────────────────────────────────────────────────────────────
const approveAdjustment = async (industryId, id, userId, userName) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ex = await client.query(`SELECT * FROM stock_adjustments WHERE id=$1 AND industry_id=$2`, [id, industryId]);
    if (ex.rows.length === 0) throw new Error('Stock Adjustment not found');
    if (ex.rows[0].status === 'Completed') throw new Error('Already completed');
    const oldData = ex.rows[0];
    await client.query(`UPDATE stock_adjustments SET status='Completed',updated_at=NOW() WHERE id=$1 AND industry_id=$2`, [id, industryId]);
    const locId = await resolveLocationId(client, ex.rows[0].location, industryId);
    await applyStockImpact(id, 'apply', client, locId);
    await client.query('COMMIT');
    const updated = await fetchAdjustmentById(id, industryId);

    logAudit({
      userId, userName,
      module: 'Stock Adjustments',
      action: 'UPDATE',
      recordId: id,
      recordLabel: updated?.reference_no || String(id),
      oldData,
      newData: updated,
    }).catch(() => {});

    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
// ── STATS ─────────────────────────────────────────────────────────────────────
const getAdjustmentStats = async (industryId) => {
  const r = await pool.query(`
    SELECT
      COUNT(*)                                              AS total_adjustments,
      COUNT(*) FILTER (WHERE status='Draft')               AS draft_count,
      COUNT(*) FILTER (WHERE status='Pending')             AS pending_count,
      COUNT(*) FILTER (WHERE status='Completed')           AS completed_count,
      COUNT(*) FILTER (WHERE adjustment_type='Normal')     AS normal_count,
      COUNT(*) FILTER (WHERE adjustment_type='Abnormal')   AS abnormal_count,
      COALESCE(SUM(total_amount),0)                        AS total_value,
      COALESCE(SUM(total_amount_recovered),0)              AS total_recovered,
      COALESCE(SUM(total_amount)-SUM(total_amount_recovered),0) AS net_loss
    FROM stock_adjustments
    WHERE industry_id = $1
  `, [industryId]);
  return r.rows[0];
};

// ── PRODUCTS LIST — mirrors stockTransferService exactly ──────────────────────
const getProductsList = async (industryId, search = '') => {
  const params    = [industryId, ...(search ? [`%${search}%`] : [])];
  const whereExtra = search
    ? `AND (LOWER(name) LIKE LOWER($2) OR LOWER(sku) LIKE LOWER($2))`
    : '';
  const r = await pool.query(
    `SELECT id, name AS product_name, sku,
            COALESCE(purchase_price_exc_tax,0) AS unit_cost,
            COALESCE(current_stock,0)          AS current_stock
     FROM   products
     WHERE  industry_id = $1
       AND  (status IS NULL OR status NOT IN ('inactive','disabled'))
     ${whereExtra}
     ORDER  BY name LIMIT 60`,
    params
  );
  return r.rows;
};

// ── LOCATIONS ─────────────────────────────────────────────────────────────────
const getLocations = async (industryId) => {
  try {
    const r = await pool.query(
      `SELECT DISTINCT location_name AS location FROM business_locations
       WHERE (is_active = true OR is_active IS NULL) AND industry_id = $1
       ORDER BY location_name`,
      [industryId]
    );
    if (r.rows.length > 0) return r.rows.map(row => row.location);
  } catch (err) {
    console.error('❌ getLocations (business_locations) error:', err.message);
  }
  const r = await pool.query(
    `SELECT DISTINCT location FROM stock_adjustments
     WHERE location IS NOT NULL AND industry_id = $1 ORDER BY location`,
    [industryId]
  );
  return r.rows.map(row => row.location);
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