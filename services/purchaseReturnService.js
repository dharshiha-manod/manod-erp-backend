/**
 * ====================================================
 * services/purchaseReturnService.js
 * Matches the real purchase_returns DB schema.
 * Existing cols: id, return_number, purchase_order_id, supplier_id,
 *                return_date, total_amount, reason
 * We ALTER TABLE to add extra columns on first use (idempotent).
 * ====================================================
 */

const pool = require('../config/database');

// ── ENSURE EXTRA COLUMNS EXIST (run once) ────────────────────────────────────
let schemaReady = false;
const ensureSchema = async () => {
  if (schemaReady) return;
  try {
    await pool.query(`
      ALTER TABLE purchase_returns
        ADD COLUMN IF NOT EXISTS supplier_name  VARCHAR(255),
        ADD COLUMN IF NOT EXISTS location       VARCHAR(255),
        ADD COLUMN IF NOT EXISTS purchase_ref   VARCHAR(100),
        ADD COLUMN IF NOT EXISTS tax_label      VARCHAR(50)  DEFAULT 'None',
        ADD COLUMN IF NOT EXISTS tax_amount     NUMERIC(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS subtotal       NUMERIC(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50)  DEFAULT 'Due',
        ADD COLUMN IF NOT EXISTS payment_due    NUMERIC(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amount_paid    NUMERIC(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS added_by       UUID,
        ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ;
    `);
    await pool.query(`
      ALTER TABLE purchase_return_items
        ADD COLUMN IF NOT EXISTS product_name   VARCHAR(255),
        ADD COLUMN IF NOT EXISTS product_sku    VARCHAR(100);
    `);
    schemaReady = true;
    console.log('✅ purchase_returns schema ready');
  } catch (err) {
    console.error('Schema migration warning:', err.message);
    schemaReady = true; // don't retry endlessly
  }
};

// ── AUTO-GENERATE REFERENCE NUMBER ───────────────────────────────────────────
const generateReturnNumber = async () => {
  const result = await pool.query(
    `SELECT return_number FROM purchase_returns
     WHERE return_number LIKE 'PR-%'
     ORDER BY id DESC LIMIT 1`
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].return_number.replace('PR-', ''), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `PR-${String(next).padStart(4, '0')}`;
};

// ── FETCH ALL (paginated) ─────────────────────────────────────────────────────
const fetchAllReturns = async (filters = {}) => {
  await ensureSchema();
  const { page = 1, limit = 25, search = '', supplier_id = '', date_from = '', date_to = '' } = filters;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const params = [];
  const wheres = [];

  if (search) {
    params.push(`%${search}%`);
    wheres.push(`(pr.return_number ILIKE $${params.length} OR COALESCE(pr.supplier_name,'') ILIKE $${params.length} OR COALESCE(pr.purchase_ref,'') ILIKE $${params.length})`);
  }
  if (supplier_id) {
    params.push(supplier_id);
    wheres.push(`pr.supplier_id = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    wheres.push(`pr.return_date >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    wheres.push(`pr.return_date <= $${params.length}`);
  }

  const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';

  const countRes = await pool.query(`SELECT COUNT(*) FROM purchase_returns pr ${where}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  params.push(parseInt(limit, 10));
  params.push(offset);

  const result = await pool.query(
    `SELECT pr.* FROM purchase_returns pr ${where}
     ORDER BY pr.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const returns = await Promise.all(result.rows.map(async (r) => {
    const items = await pool.query(
      `SELECT * FROM purchase_return_items WHERE purchase_return_id = $1 ORDER BY id`,
      [r.id]
    );
    return { ...r, items: items.rows };
  }));

  return { rows: returns, total };
};

// ── FETCH SINGLE ──────────────────────────────────────────────────────────────
const fetchReturnById = async (id) => {
  await ensureSchema();
  const result = await pool.query(`SELECT * FROM purchase_returns WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  const ret = result.rows[0];
  const items = await pool.query(
    `SELECT * FROM purchase_return_items WHERE purchase_return_id = $1 ORDER BY id`,
    [id]
  );
  return { ...ret, items: items.rows };
};

// ── CREATE ────────────────────────────────────────────────────────────────────
const createReturn = async (body, userId) => {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const returnNumber = body.return_number || await generateReturnNumber();
    const existing = await client.query(
      `SELECT id FROM purchase_returns WHERE return_number = $1`, [returnNumber]
    );
    if (existing.rows.length > 0) throw new Error(`Return number ${returnNumber} already exists`);

    const items      = Array.isArray(body.items) ? body.items : [];
    const subtotal   = parseFloat(body.subtotal)     || items.reduce((s, i) => s + parseFloat(i.subtotal || 0), 0);
    const taxAmount  = parseFloat(body.tax_amount)   || 0;
    const totalAmt   = parseFloat(body.total_amount) || subtotal + taxAmount;
    const amtPaid    = parseFloat(body.amount_paid)  || 0;
    const payDue     = Math.max(0, totalAmt - amtPaid);
    let   payStatus  = amtPaid >= totalAmt && totalAmt > 0 ? 'Paid' : amtPaid > 0 ? 'Partial' : 'Due';

    const ins = await client.query(
      `INSERT INTO purchase_returns (
        return_number, purchase_order_id, supplier_id, supplier_name,
        location, purchase_ref, tax_label, tax_amount, subtotal,
        total_amount, payment_status, payment_due, amount_paid,
        reason, return_date, added_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15)
      RETURNING *`,
      [
        returnNumber,
        body.purchase_order_id || null,
        body.supplier_id       || null,
        body.supplier_name     || null,
        body.location          || null,
        body.purchase_ref      || null,
        body.tax_label         || 'None',
        taxAmount,
        subtotal,
        totalAmt,
        payStatus,
        payDue,
        amtPaid,
        body.reason            || null,
        userId                 || null,
      ]
    );

    const pr = ins.rows[0];

    for (const item of items) {
      const qty  = parseFloat(item.quantity)   || 1;
      const price= parseFloat(item.unit_price) || parseFloat(item.unit_cost) || 0;
      const tot  = parseFloat(item.subtotal)   || qty * price;
      await client.query(
        `INSERT INTO purchase_return_items
           (purchase_return_id, product_id, product_name, product_sku, quantity, unit_price, total_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pr.id, item.product_id || null, item.product_name || item.name || 'Unnamed',
         item.product_sku || item.sku || null, qty, price, +tot.toFixed(2)]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ Purchase Return created: ${returnNumber}`);
    return fetchReturnById(pr.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── UPDATE ────────────────────────────────────────────────────────────────────
const updateReturn = async (id, body) => {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ex = await client.query(`SELECT id FROM purchase_returns WHERE id = $1`, [id]);
    if (ex.rows.length === 0) throw new Error('Purchase return not found');

    const items     = Array.isArray(body.items) ? body.items : null;
    const subtotal  = parseFloat(body.subtotal)     || 0;
    const taxAmount = parseFloat(body.tax_amount)   || 0;
    const totalAmt  = parseFloat(body.total_amount) || subtotal + taxAmount;
    const amtPaid   = parseFloat(body.amount_paid)  || 0;
    const payDue    = Math.max(0, totalAmt - amtPaid);
    const payStatus = amtPaid >= totalAmt && totalAmt > 0 ? 'Paid' : amtPaid > 0 ? 'Partial' : 'Due';

    await client.query(
      `UPDATE purchase_returns SET
        supplier_id=$1, supplier_name=$2, location=$3, purchase_ref=$4,
        tax_label=$5, tax_amount=$6, subtotal=$7, total_amount=$8,
        payment_status=$9, payment_due=$10, amount_paid=$11,
        reason=$12, updated_at=NOW()
       WHERE id=$13`,
      [body.supplier_id||null, body.supplier_name||null, body.location||null,
       body.purchase_ref||null, body.tax_label||'None', taxAmount, subtotal,
       totalAmt, payStatus, payDue, amtPaid,
       body.reason||null, id]
    );

    if (items) {
      await client.query(`DELETE FROM purchase_return_items WHERE purchase_return_id = $1`, [id]);
      for (const item of items) {
        const qty  = parseFloat(item.quantity)   || 1;
        const price= parseFloat(item.unit_price) || parseFloat(item.unit_cost) || 0;
        const tot  = parseFloat(item.subtotal)   || qty * price;
        await client.query(
          `INSERT INTO purchase_return_items
             (purchase_return_id, product_id, product_name, product_sku, quantity, unit_price, total_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, item.product_id||null, item.product_name||item.name||'Unnamed',
           item.product_sku||item.sku||null, qty, price, +tot.toFixed(2)]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Purchase Return updated: id ${id}`);
    return fetchReturnById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── DELETE ────────────────────────────────────────────────────────────────────
const deleteReturn = async (id) => {
  const result = await pool.query(
    `DELETE FROM purchase_returns WHERE id = $1 RETURNING id, return_number`,
    [id]
  );
  if (result.rows.length === 0) throw new Error('Purchase return not found');
  console.log(`🗑️  Purchase Return deleted: ${result.rows[0].return_number}`);
  return result.rows[0];
};

module.exports = { fetchAllReturns, fetchReturnById, createReturn, updateReturn, deleteReturn };